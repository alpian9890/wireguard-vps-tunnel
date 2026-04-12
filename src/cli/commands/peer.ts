import { Command } from 'commander';
import { z } from 'zod';

import { copyTextToClipboard } from '../../core/clipboard';
import { AppError } from '../../core/errors';
import { loadInventory } from '../../core/inventory/store';
import { runRemote } from '../../core/ssh/run-remote';
import {
  findWindowsPeerRecordById,
  listWindowsPeerRecords,
  upsertWindowsPeerRecord,
  type WindowsPeerRecord,
} from '../../core/windows-peer-store';
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
  copy: z.boolean().default(false),
});

const windowsListOptionsSchema = z.object({
  target: z.string().min(1).optional(),
});

const windowsShowOptionsSchema = z.object({
  id: z.string().min(1),
  copy: z.boolean().default(false),
});

interface ConfigPeerEntry {
  name: string;
  publicKey: string;
  allowedIps: string;
}

interface RuntimePeerEntry {
  publicKey: string;
  endpoint: string;
  allowedIps: string;
  latestHandshakeEpoch: number;
  transferRxBytes: number;
  transferTxBytes: number;
}

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

function shortKey(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  let result = value;
  while (result >= 1024 && unit < units.length - 1) {
    result /= 1024;
    unit += 1;
  }
  return `${result.toFixed(result < 10 && unit > 0 ? 2 : 1)} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'never';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function extractSection(content: string, beginMarker: string, endMarker: string): string {
  const begin = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new AppError('Output remote peer list tidak valid (marker section tidak ditemukan)');
  }
  return content.slice(begin + beginMarker.length, end).trim();
}

function parseConfigPeers(configContent: string): Map<string, ConfigPeerEntry> {
  const result = new Map<string, ConfigPeerEntry>();
  const lines = configContent.split('\n');
  let insidePeer = false;
  let name = '';
  let publicKey = '';
  let allowedIps = '';

  const flush = (): void => {
    if (!insidePeer || !publicKey) return;
    result.set(publicKey, {
      name: name || '(unknown)',
      publicKey,
      allowedIps: allowedIps || '-',
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '[Peer]') {
      flush();
      insidePeer = true;
      name = '';
      publicKey = '';
      allowedIps = '';
      continue;
    }

    if (!insidePeer) continue;
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!name) {
        name = line.replace(/^#\s*/, '').trim();
      }
      continue;
    }
    if (line.startsWith('[')) {
      flush();
      insidePeer = false;
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) continue;
    const key = keyValueMatch[1];
    const value = keyValueMatch[2].trim();
    if (key === 'PublicKey') publicKey = value;
    if (key === 'AllowedIPs') allowedIps = value;
  }

  flush();
  return result;
}

function parseRuntimePeers(dumpContent: string): Map<string, RuntimePeerEntry> {
  const result = new Map<string, RuntimePeerEntry>();
  const lines = dumpContent.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return result;

  for (const line of lines.slice(1)) {
    const fields = line.split('\t');
    if (fields.length < 8) continue;
    const publicKey = fields[0]?.trim();
    if (!publicKey) continue;
    result.set(publicKey, {
      publicKey,
      endpoint: fields[2]?.trim() || '(none)',
      allowedIps: fields[3]?.trim() || '-',
      latestHandshakeEpoch: Number(fields[4] || '0'),
      transferRxBytes: Number(fields[5] || '0'),
      transferTxBytes: Number(fields[6] || '0'),
    });
  }

  return result;
}

function extractEndpointHost(endpoint: string): string {
  if (!endpoint || endpoint === '(none)') return '';
  if (endpoint.startsWith('[')) {
    const closeIdx = endpoint.indexOf(']');
    return closeIdx > 1 ? endpoint.slice(1, closeIdx) : endpoint;
  }
  const idx = endpoint.lastIndexOf(':');
  return idx > 0 ? endpoint.slice(0, idx) : endpoint;
}

function printWindowsPeerRecord(record: WindowsPeerRecord): void {
  console.log(`ID: ${record.id}`);
  console.log(`Target host: ${record.target}`);
  console.log(`Interface: ${record.iface}`);
  console.log(`Client name: ${record.clientName}`);
  console.log(`Client tunnel IP: ${record.clientIp}`);
  console.log(`Endpoint: ${record.endpoint}:${record.listenPort}`);
  console.log(`Created at: ${record.createdAt}`);
  console.log(`Updated at: ${record.updatedAt}`);
  console.log(`Client public key: ${record.clientPublicKey}`);
  console.log(`Host public key: ${record.hostPublicKey}`);
  console.log('');
  console.log('--- BEGIN WINDOWS CLIENT CONFIG ---');
  console.log(record.config);
  console.log('--- END WINDOWS CLIENT CONFIG ---');
}

export function registerPeerCommands(program: Command): void {
  const peer = program.command('peer').description('Kelola peer WireGuard pada target host');

  peer
    .command('list')
    .description('Tampilkan daftar peer lengkap (owner, key, IP, endpoint, handshake, transfer)')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      assertServerRole(server, 'host');
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);

      const remoteOutput = await runRemoteChecked(
        server,
        `
set -euo pipefail
WG_IFACE=${shellEscape(wgInterface)}
CONF_PATH="/etc/wireguard/\${WG_IFACE}.conf"
if [[ ! -f "$CONF_PATH" ]]; then
  echo "ERROR=Config host tidak ditemukan di $CONF_PATH. Jalankan host init dulu."
  exit 1
fi
echo "__WGM_CONF_BEGIN__"
${sudo}cat "$CONF_PATH"
echo "__WGM_CONF_END__"
echo "__WGM_DUMP_BEGIN__"
${sudo}wg show "$WG_IFACE" dump
echo "__WGM_DUMP_END__"
`,
      );

      const confContent = extractSection(remoteOutput, '__WGM_CONF_BEGIN__', '__WGM_CONF_END__');
      const dumpContent = extractSection(remoteOutput, '__WGM_DUMP_BEGIN__', '__WGM_DUMP_END__');
      const configPeers = parseConfigPeers(confContent);
      const runtimePeers = parseRuntimePeers(dumpContent);
      const windowsRecords = await listWindowsPeerRecords(server.name);
      const windowsByPublicKey = new Map(
        windowsRecords.map((record) => [record.clientPublicKey, record] as const),
      );

      const inventory = await loadInventory();
      const clientsByHost = new Map(
        inventory.servers
          .filter((item) => item.role === 'client')
          .map((item) => [item.host, item.name] as const),
      );

      const allPublicKeys = new Set<string>([
        ...Array.from(configPeers.keys()),
        ...Array.from(runtimePeers.keys()),
      ]);
      const orderedKeys = Array.from(allPublicKeys).sort((a, b) => a.localeCompare(b));

      if (orderedKeys.length === 0) {
        console.log(`Peer kosong di ${server.name}/${wgInterface}`);
        return;
      }

      console.log(`Peer list host=${server.name} iface=${wgInterface}`);
      console.log(`Total peer: ${orderedKeys.length}`);
      console.log('');

      const now = Math.floor(Date.now() / 1000);
      for (const publicKey of orderedKeys) {
        const cfg = configPeers.get(publicKey);
        const runtime = runtimePeers.get(publicKey);
        const windows = windowsByPublicKey.get(publicKey);
        const endpoint = runtime?.endpoint || '(none)';
        const endpointHost = extractEndpointHost(endpoint);
        const inventoryOwner = endpointHost ? clientsByHost.get(endpointHost) : undefined;
        const owner = windows?.clientName || cfg?.name || inventoryOwner || '(unknown)';
        const source = windows ? 'windows-record' : cfg ? 'host-config' : 'runtime-only';
        const privateKeyInfo = windows
          ? `tersimpan di /etc/wgm/windows-peers.json (id=${windows.id})`
          : 'tidak disimpan di host list (private key ada di sisi client)';
        const handshakeAge = runtime?.latestHandshakeEpoch
          ? formatDuration(now - runtime.latestHandshakeEpoch)
          : 'never';

        console.log(`- Owner: ${owner}`);
        console.log(`  Source: ${source}`);
        console.log(`  PublicKey: ${publicKey}`);
        console.log(`  PrivateKey: ${privateKeyInfo}`);
        console.log(`  AllowedIPs: ${cfg?.allowedIps || runtime?.allowedIps || '-'}`);
        console.log(`  Endpoint aktif: ${endpoint}`);
        console.log(`  Inventory client match: ${inventoryOwner || '-'}`);
        console.log(`  Handshake terakhir: ${handshakeAge}`);
        console.log(
          `  Transfer: RX ${formatBytes(runtime?.transferRxBytes || 0)} | TX ${formatBytes(runtime?.transferTxBytes || 0)}`,
        );
        console.log('');
      }
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
    .description('Buat peer client Windows + output config + simpan arsip lokal')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .requiredOption('--client-name <name>', 'Nama client windows, contoh: win-laptop-1')
    .requiredOption('--client-ip <cidr>', 'IP tunnel client, contoh: 10.0.0.4/32')
    .option('--iface <iface>', 'Override interface WireGuard host')
    .option('--endpoint <host>', 'Override endpoint host di config client')
    .option('--listen-port <port>', 'Listen port host', '51820')
    .option('--dns <dns>', 'DNS di config client windows', '1.1.1.1')
    .option('--allowed-ips <cidrs>', 'AllowedIPs di config client', '0.0.0.0/0, ::/0')
    .option('--keepalive <seconds>', 'PersistentKeepalive di config client', '25')
    .option('--copy', 'Copy config hasil generate ke clipboard lokal')
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
      const clientPublicKey = peerData.CLIENT_PUBLIC_KEY;
      if (!clientPrivateKey || !hostPublicKey || !clientPublicKey) {
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

      const { record, filePath } = await upsertWindowsPeerRecord({
        target: server.name,
        iface: wgInterface,
        clientName: peerData.CLIENT_NAME || options.clientName,
        clientIp: peerData.CLIENT_IP || options.clientIp,
        endpoint,
        listenPort: options.listenPort,
        dns: options.dns,
        allowedIps: options.allowedIps,
        keepalive: options.keepalive,
        hostPublicKey,
        clientPublicKey,
        config: windowsConfig,
      });

      console.log(`Peer Windows "${record.clientName}" berhasil ditambahkan.`);
      console.log(`Record ID: ${record.id}`);
      console.log(`Arsip config: ${filePath}`);
      if (options.copy) {
        const clipboardTool = copyTextToClipboard(windowsConfig);
        console.log(`Config berhasil disalin ke clipboard (${clipboardTool}).`);
      }
      console.log('--- BEGIN WINDOWS CLIENT CONFIG ---');
      console.log(windowsConfig);
      console.log('--- END WINDOWS CLIENT CONFIG ---');
    });

  const windows = peer.command('windows').description('Kelola arsip config peer Windows di mesin lokal');

  windows
    .command('list')
    .description('Tampilkan daftar peer Windows yang tersimpan')
    .option('--target <name>', 'Filter target host')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = windowsListOptionsSchema.parse(rawOptions);
      const records = await listWindowsPeerRecords(options.target);
      if (records.length === 0) {
        console.log('Belum ada arsip peer Windows tersimpan.');
        return;
      }

      console.log(`Windows peer records: ${records.length}`);
      for (const record of records) {
        console.log(
          `${record.id} | updated=${record.updatedAt} | target=${record.target} | client=${record.clientName} | ip=${record.clientIp} | pub=${shortKey(record.clientPublicKey)}`,
        );
      }
    });

  windows
    .command('show')
    .description('Tampilkan detail 1 arsip peer Windows')
    .requiredOption('--id <id>', 'ID record peer windows')
    .option('--copy', 'Copy config ke clipboard')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = windowsShowOptionsSchema.parse(rawOptions);
      const record = await findWindowsPeerRecordById(options.id);
      if (!record) {
        throw new AppError(`Record peer Windows dengan id "${options.id}" tidak ditemukan`);
      }
      if (options.copy) {
        const clipboardTool = copyTextToClipboard(record.config);
        console.log(`Config berhasil disalin ke clipboard (${clipboardTool}).`);
        console.log('');
      }
      printWindowsPeerRecord(record);
    });

  windows
    .command('copy')
    .description('Copy config peer Windows dari arsip ke clipboard')
    .requiredOption('--id <id>', 'ID record peer windows')
    .action(async (options: { id: string }) => {
      const record = await findWindowsPeerRecordById(options.id);
      if (!record) {
        throw new AppError(`Record peer Windows dengan id "${options.id}" tidak ditemukan`);
      }
      const clipboardTool = copyTextToClipboard(record.config);
      console.log(`Config ${record.id} berhasil disalin ke clipboard (${clipboardTool}).`);
    });
}
