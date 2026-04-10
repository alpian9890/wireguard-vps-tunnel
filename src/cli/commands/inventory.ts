import { Command } from 'commander';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import {
  findServer,
  initInventoryIfMissing,
  loadInventory,
  removeServer,
  saveInventory,
  upsertServer,
} from '../../core/inventory/store';
import { serverSchema, serverRoleSchema } from '../../core/inventory/schema';
import { DEFAULT_INVENTORY_PATH } from '../../core/paths';

const addOptionsSchema = z.object({
  name: z.string().min(1),
  role: serverRoleSchema,
  host: z.string().min(1),
  user: z.string().min(1).default('root'),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  iface: z.string().min(1).default('wg0'),
  auth: z.enum(['agent', 'key', 'password']).default('agent'),
  keyPath: z.string().optional(),
  passphraseEnv: z.string().optional(),
  passwordEnv: z.string().optional(),
  tags: z.string().optional(),
});

function parseTags(tagsRaw?: string): string[] {
  if (!tagsRaw) return [];
  return tagsRaw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function registerInventoryCommands(program: Command): void {
  const inventory = program.command('inventory').description('Kelola inventory multi-server');

  inventory
    .command('init')
    .description('Buat file inventory default bila belum ada')
    .action(async () => {
      const filePath = await initInventoryIfMissing();
      console.log(`Inventory siap: ${filePath}`);
    });

  inventory
    .command('path')
    .description('Tampilkan path inventory aktif')
    .action(() => {
      console.log(process.env.WGM_INVENTORY_PATH || DEFAULT_INVENTORY_PATH);
    });

  inventory
    .command('list')
    .description('Tampilkan semua server di inventory')
    .action(async () => {
      const data = await loadInventory();
      if (data.servers.length === 0) {
        console.log('Inventory kosong. Tambahkan server dengan: wgm inventory add ...');
        return;
      }

      for (const server of data.servers) {
        console.log(
          `${server.name} | role=${server.role} | ${server.user}@${server.host}:${server.port} | iface=${server.wgInterface} | auth=${server.auth.method}`,
        );
      }
    });

  inventory
    .command('show')
    .description('Tampilkan detail 1 server')
    .requiredOption('--name <name>', 'Nama server')
    .action(async (options: { name: string }) => {
      const data = await loadInventory();
      const server = findServer(data, options.name);
      if (!server) {
        throw new AppError(`Server "${options.name}" tidak ditemukan`);
      }
      console.log(JSON.stringify(server, null, 2));
    });

  inventory
    .command('add')
    .description('Tambah atau update server di inventory')
    .requiredOption('--name <name>', 'Nama unik server')
    .requiredOption('--role <role>', 'Role: host|client')
    .requiredOption('--host <host>', 'Hostname/IP server')
    .option('--user <user>', 'SSH username', 'root')
    .option('--port <port>', 'SSH port', '22')
    .option('--iface <iface>', 'WireGuard interface', 'wg0')
    .option('--auth <auth>', 'agent|key|password', 'agent')
    .option('--key-path <path>', 'Path private key untuk auth=key')
    .option('--passphrase-env <env>', 'Nama ENV passphrase untuk auth=key')
    .option('--password-env <env>', 'Nama ENV password untuk auth=password')
    .option('--tags <tags>', 'Tag dipisah koma, contoh: prod,host')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = addOptionsSchema.parse(rawOptions);

      let auth:
        | { method: 'agent' }
        | { method: 'key'; privateKeyPath: string; passphraseEnv?: string }
        | { method: 'password'; passwordEnv: string };

      if (options.auth === 'key') {
        if (!options.keyPath) {
          throw new AppError('auth=key membutuhkan --key-path');
        }
        auth = {
          method: 'key',
          privateKeyPath: options.keyPath,
          passphraseEnv: options.passphraseEnv,
        };
      } else if (options.auth === 'password') {
        if (!options.passwordEnv) {
          throw new AppError('auth=password membutuhkan --password-env');
        }
        auth = {
          method: 'password',
          passwordEnv: options.passwordEnv,
        };
      } else {
        auth = { method: 'agent' };
      }

      const server = serverSchema.parse({
        name: options.name,
        role: options.role,
        host: options.host,
        user: options.user,
        port: options.port,
        wgInterface: options.iface,
        auth,
        tags: parseTags(options.tags),
      });

      const data = await loadInventory();
      const updated = upsertServer(data, server);
      const filePath = await saveInventory(updated);

      console.log(`Server "${server.name}" tersimpan di ${filePath}`);
    });

  inventory
    .command('remove')
    .description('Hapus server dari inventory')
    .requiredOption('--name <name>', 'Nama server')
    .action(async (options: { name: string }) => {
      const data = await loadInventory();
      const exists = Boolean(findServer(data, options.name));
      if (!exists) {
        throw new AppError(`Server "${options.name}" tidak ditemukan`);
      }

      const updated = removeServer(data, options.name);
      const filePath = await saveInventory(updated);
      console.log(`Server "${options.name}" dihapus dari ${filePath}`);
    });
}

