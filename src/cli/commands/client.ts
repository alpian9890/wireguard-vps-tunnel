import fs from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import {
  assertRootUser,
  assertServerRole,
  getServerByName,
  parseKeyValueLines,
  runRemoteChecked,
  shellEscape,
} from './shared';

const clientInitOptionsSchema = z.object({
  target: z.string().min(1),
  hostTarget: z.string().min(1),
  iface: z.string().min(1).optional(),
  hostIface: z.string().min(1).optional(),
  clientIp: z.string().min(1),
  endpoint: z.string().min(1).optional(),
  listenPort: z.coerce.number().int().min(1).max(65535).default(51820),
  dns: z.string().min(1).default('1.1.1.1, 8.8.8.8'),
  skipPackageInstall: z.boolean().default(false),
  skipScriptDeploy: z.boolean().default(false),
});

async function loadScript(fileName: string): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'scripts', fileName),
    path.resolve(__dirname, '../../../scripts', fileName),
    path.resolve(__dirname, '../../../../scripts', fileName),
  ];

  for (const scriptPath of candidates) {
    try {
      return await fs.readFile(scriptPath, 'utf-8');
    } catch {
      continue;
    }
  }

  throw new AppError(`Script ${fileName} tidak ditemukan di project`);
}

function buildWriteFileCommand(remotePath: string, content: string, mode: string): string {
  const delimiter = '__WGM_REMOTE_EOF__';
  if (content.includes(delimiter)) {
    throw new AppError(`Konten file ${remotePath} mengandung delimiter internal yang tidak didukung`);
  }
  return `
cat >${shellEscape(remotePath)} <<'${delimiter}'
${content}
${delimiter}
chmod ${shellEscape(mode)} ${shellEscape(remotePath)}
`;
}

export function registerClientCommands(program: Command): void {
  const client = program.command('client').description('Operasi setup client WireGuard');

  client
    .command('init')
    .description('Setup client WireGuard lalu sambungkan ke host')
    .requiredOption('--target <name>', 'Nama target client di inventory')
    .requiredOption('--host-target <name>', 'Nama target host di inventory')
    .requiredOption('--client-ip <cidr>', 'IP tunnel client, contoh: 10.0.0.2/32')
    .option('--iface <iface>', 'Override interface WireGuard client')
    .option('--host-iface <iface>', 'Override interface WireGuard host')
    .option('--endpoint <host>', 'Override endpoint host (default: host inventory)')
    .option('--listen-port <port>', 'ListenPort host', '51820')
    .option('--dns <dns>', 'DNS client', '1.1.1.1, 8.8.8.8')
    .option('--skip-package-install', 'Lewati apt install package')
    .option('--skip-script-deploy', 'Lewati deploy tunnel-up/down script')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = clientInitOptionsSchema.parse(rawOptions);
      const clientServer = await getServerByName(options.target);
      const hostServer = await getServerByName(options.hostTarget);

      assertServerRole(clientServer, 'client');
      assertServerRole(hostServer, 'host');
      assertRootUser(clientServer);
      assertRootUser(hostServer);

      const clientWgIface = options.iface || clientServer.wgInterface;
      const hostWgIface = options.hostIface || hostServer.wgInterface;
      const endpoint = options.endpoint || hostServer.host;

      const installBlock = options.skipPackageInstall
        ? 'echo "SKIP_PKG_INSTALL=1"'
        : 'apt-get update -y >/dev/null && apt-get install -y wireguard iptables iproute2 resolvconf curl >/dev/null';

      const keyOutput = await runRemoteChecked(
        clientServer,
        `
set -euo pipefail
${installBlock}
install -d -m 700 /etc/wireguard
if [[ ! -f /etc/wireguard/client.key || ! -f /etc/wireguard/client.pub ]]; then
  umask 077
  wg genkey | tee /etc/wireguard/client.key | wg pubkey > /etc/wireguard/client.pub
fi
echo "CLIENT_PRIVATE_KEY=$(cat /etc/wireguard/client.key)"
echo "CLIENT_PUBLIC_KEY=$(cat /etc/wireguard/client.pub)"
`,
      );
      const keyData = parseKeyValueLines(keyOutput);
      const clientPrivateKey = keyData.CLIENT_PRIVATE_KEY;
      const clientPublicKey = keyData.CLIENT_PUBLIC_KEY;
      if (!clientPrivateKey || !clientPublicKey) {
        throw new AppError('Gagal membaca key pair client');
      }

      const hostKeyOutput = await runRemoteChecked(
        hostServer,
        `cat ${shellEscape(`/etc/wireguard/server.pub`)}`,
      );
      const hostPublicKey = hostKeyOutput.trim();
      if (!hostPublicKey) {
        throw new AppError('Public key host tidak ditemukan. Jalankan host init terlebih dahulu.');
      }

      await runRemoteChecked(
        hostServer,
        `
set -euo pipefail
WG_IFACE=${shellEscape(hostWgIface)}
CLIENT_PUBLIC_KEY=${shellEscape(clientPublicKey)}
CLIENT_IP=${shellEscape(options.clientIp)}
CONF_PATH="/etc/wireguard/\${WG_IFACE}.conf"

wg set "$WG_IFACE" peer "$CLIENT_PUBLIC_KEY" allowed-ips "$CLIENT_IP"

if ! grep -q "PublicKey = $CLIENT_PUBLIC_KEY" "$CONF_PATH"; then
  cat >>"$CONF_PATH" <<EOF_PEER

[Peer]
# ${shellEscape(clientServer.name)}
PublicKey = $CLIENT_PUBLIC_KEY
AllowedIPs = $CLIENT_IP
EOF_PEER
fi

systemctl restart wg-quick@"$WG_IFACE"
`,
      );

      if (!options.skipScriptDeploy) {
        const tunnelUpScript = await loadScript('tunnel-up.sh');
        const tunnelDownScript = await loadScript('tunnel-down.sh');
        await runRemoteChecked(
          clientServer,
          `
set -euo pipefail
install -d -m 700 /etc/wireguard
${buildWriteFileCommand('/etc/wireguard/tunnel-up.sh', tunnelUpScript, '700')}
${buildWriteFileCommand('/etc/wireguard/tunnel-down.sh', tunnelDownScript, '700')}
`,
        );
      }

      const clientConfig = [
        '[Interface]',
        `PrivateKey = ${clientPrivateKey}`,
        `Address = ${options.clientIp}`,
        `DNS = ${options.dns}`,
        'Table = off',
        'PostUp  = /etc/wireguard/tunnel-up.sh %i',
        'PreDown = /etc/wireguard/tunnel-down.sh %i',
        '',
        '[Peer]',
        `PublicKey = ${hostPublicKey}`,
        `Endpoint = ${endpoint}:${options.listenPort}`,
        'AllowedIPs = 0.0.0.0/0',
        'PersistentKeepalive = 25',
        '',
      ].join('\n');

      await runRemoteChecked(
        clientServer,
        `
set -euo pipefail
install -d -m 700 /etc/wireguard
${buildWriteFileCommand(`/etc/wireguard/${clientWgIface}.conf`, clientConfig, '600')}
systemctl enable wg-quick@${shellEscape(clientWgIface)} >/dev/null 2>&1 || true
systemctl restart wg-quick@${shellEscape(clientWgIface)}
`,
      );

      console.log(`Client ${clientServer.name} berhasil dikonfigurasi dan terhubung ke host ${hostServer.name}.`);
      console.log(`Client IP tunnel: ${options.clientIp}`);
      console.log(`Endpoint: ${endpoint}:${options.listenPort}`);
    });
}
