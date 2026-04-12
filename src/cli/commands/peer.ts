import { Command } from 'commander';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import { runRemote } from '../../core/ssh/run-remote';
import {
  assertRootUser,
  assertServerRole,
  getServerByName,
  getSudoPrefix,
  parseKeyValueLines,
  runRemoteChecked,
  shellEscape,
} from './shared';

const addWindowsOptionsSchema = z.object({
  target: z.string().min(1),
  clientName: z.string().min(1),
  clientIp: z.string().min(1),
  iface: z.string().min(1).optional(),
  endpoint: z.string().min(1).optional(),
  listenPort: z.coerce.number().int().min(1).max(65535).default(51820),
  dns: z.string().min(1).default('1.1.1.1'),
  allowedIps: z.string().min(1).default('0.0.0.0/0, ::/0'),
  keepalive: z.coerce.number().int().min(0).max(65535).default(25),
});

function buildWindowsClientConfig(params: {
  clientPrivateKey: string;
  clientAddress: string;
  dns: string;
  hostPublicKey: string;
  allowedIps: string;
  endpoint: string;
  listenPort: number;
  keepalive: number;
}): string {
  return [
    '[Interface]',
    `PrivateKey = ${params.clientPrivateKey}`,
    `Address = ${params.clientAddress}`,
    `DNS = ${params.dns}`,
    '',
    '[Peer]',
    `PublicKey = ${params.hostPublicKey}`,
    `AllowedIPs = ${params.allowedIps}`,
    `Endpoint = ${params.endpoint}:${params.listenPort}`,
    `PersistentKeepalive = ${params.keepalive}`,
    '',
  ].join('\n');
}

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

  peer
    .command('add-windows')
    .description('Buat peer client Windows + output config WireGuard siap pakai')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .requiredOption('--client-name <name>', 'Nama client windows, contoh: win-laptop-1')
    .requiredOption('--client-ip <cidr>', 'IP tunnel client, contoh: 10.0.0.4/32')
    .option('--iface <iface>', 'Override interface WireGuard host')
    .option('--endpoint <host>', 'Override endpoint host di config client')
    .option('--listen-port <port>', 'Listen port host', '51820')
    .option('--dns <dns>', 'DNS di config client windows', '1.1.1.1')
    .option('--allowed-ips <cidrs>', 'AllowedIPs di config client', '0.0.0.0/0, ::/0')
    .option('--keepalive <seconds>', 'PersistentKeepalive di config client', '25')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = addWindowsOptionsSchema.parse(rawOptions);
      const server = await getServerByName(options.target);
      assertServerRole(server, 'host');
      assertRootUser(server);

      const wgInterface = options.iface || server.wgInterface;
      const endpoint = options.endpoint || server.host;
      const addOutput = await runRemoteChecked(
        server,
        `
set -euo pipefail
WG_IFACE=${shellEscape(wgInterface)}
CLIENT_NAME=${shellEscape(options.clientName)}
CLIENT_IP=${shellEscape(options.clientIp)}
CONF_PATH="/etc/wireguard/\${WG_IFACE}.conf"
CLIENT_DIR="/etc/wireguard/clients"
CLIENT_KEY="\${CLIENT_DIR}/\${CLIENT_NAME}.key"
CLIENT_PUB="\${CLIENT_DIR}/\${CLIENT_NAME}.pub"
SERVER_PUB="/etc/wireguard/server.pub"

if [[ ! -f "$CONF_PATH" ]]; then
  echo "ERROR=Config host tidak ditemukan di $CONF_PATH. Jalankan host init dulu."
  exit 1
fi

if [[ ! -f "$SERVER_PUB" ]]; then
  echo "ERROR=Public key host tidak ditemukan di $SERVER_PUB. Jalankan host init dulu."
  exit 1
fi

install -d -m 700 "$CLIENT_DIR"

if [[ ! -f "$CLIENT_KEY" || ! -f "$CLIENT_PUB" ]]; then
  umask 077
  wg genkey | tee "$CLIENT_KEY" | wg pubkey > "$CLIENT_PUB"
fi

CLIENT_PRIVATE_KEY="$(cat "$CLIENT_KEY")"
CLIENT_PUBLIC_KEY="$(cat "$CLIENT_PUB")"
HOST_PUBLIC_KEY="$(cat "$SERVER_PUB")"

wg set "$WG_IFACE" peer "$CLIENT_PUBLIC_KEY" allowed-ips "$CLIENT_IP"

if ! grep -q "PublicKey = $CLIENT_PUBLIC_KEY" "$CONF_PATH"; then
  cat >>"$CONF_PATH" <<EOF_PEER

[Peer]
# $CLIENT_NAME
PublicKey = $CLIENT_PUBLIC_KEY
AllowedIPs = $CLIENT_IP
EOF_PEER
fi

systemctl restart wg-quick@"$WG_IFACE"

echo "CLIENT_NAME=$CLIENT_NAME"
echo "CLIENT_IP=$CLIENT_IP"
echo "CLIENT_PRIVATE_KEY=$CLIENT_PRIVATE_KEY"
echo "CLIENT_PUBLIC_KEY=$CLIENT_PUBLIC_KEY"
echo "HOST_PUBLIC_KEY=$HOST_PUBLIC_KEY"
`,
      );

      const peerData = parseKeyValueLines(addOutput);
      const clientPrivateKey = peerData.CLIENT_PRIVATE_KEY;
      const hostPublicKey = peerData.HOST_PUBLIC_KEY;
      if (!clientPrivateKey || !hostPublicKey) {
        throw new AppError('Gagal membuat peer windows atau membaca key hasil generate');
      }

      const windowsConfig = buildWindowsClientConfig({
        clientPrivateKey,
        clientAddress: peerData.CLIENT_IP || options.clientIp,
        dns: options.dns,
        hostPublicKey,
        allowedIps: options.allowedIps,
        endpoint,
        listenPort: options.listenPort,
        keepalive: options.keepalive,
      });

      console.log(`Peer Windows "${peerData.CLIENT_NAME || options.clientName}" berhasil ditambahkan.`);
      console.log('Salin config berikut ke aplikasi WireGuard Windows:');
      console.log('--- BEGIN WINDOWS CLIENT CONFIG ---');
      console.log(windowsConfig);
      console.log('--- END WINDOWS CLIENT CONFIG ---');
    });
}
