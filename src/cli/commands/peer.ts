import { Command } from 'commander';

import { AppError } from '../../core/errors';
import { runRemote } from '../../core/ssh/run-remote';
import { getServerByName, getSudoPrefix } from './shared';

function printRemoteOutput(stdout: string, stderr: string): void {
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

export function registerPeerCommands(program: Command): void {
  const peer = program.command('peer').description('Kelola peer WireGuard pada target host');

  peer
    .command('list')
    .description('Tampilkan daftar peer + handshake age')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);

      const command = [
        `${sudo}wg show ${wgInterface} peers`,
        `echo`,
        `${sudo}wg show ${wgInterface} latest-handshakes`,
      ].join(' ; ');

      const result = await runRemote(server, command);
      printRemoteOutput(result.stdout, result.stderr);
    });

  peer
    .command('add')
    .description('Tambah peer live (tanpa persist ke file config)')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .requiredOption('--public-key <key>', 'Public key peer')
    .requiredOption('--allowed-ip <cidr>', 'Allowed IP peer, contoh: 10.0.0.4/32')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(
      async (options: {
        target: string;
        publicKey: string;
        allowedIp: string;
        iface?: string;
      }) => {
        const server = await getServerByName(options.target);
        const wgInterface = options.iface || server.wgInterface;
        const sudo = getSudoPrefix(server);

        const command = `${sudo}wg set ${wgInterface} peer ${options.publicKey} allowed-ips ${options.allowedIp}`;
        const result = await runRemote(server, command);
        printRemoteOutput(result.stdout, result.stderr);
        console.log('Peer ditambahkan secara live. Persist manual ke /etc/wireguard/wg0.conf masih diperlukan.');
      },
    );

  peer
    .command('remove')
    .description('Hapus peer live (tanpa edit file config)')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .requiredOption('--public-key <key>', 'Public key peer')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; publicKey: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);

      if (!options.publicKey.trim()) {
        throw new AppError('Public key tidak boleh kosong');
      }

      const command = `${sudo}wg set ${wgInterface} peer ${options.publicKey} remove`;
      const result = await runRemote(server, command);
      printRemoteOutput(result.stdout, result.stderr);
      console.log('Peer dihapus secara live. Hapus juga blok [Peer] di file config host agar persist.');
    });
}

