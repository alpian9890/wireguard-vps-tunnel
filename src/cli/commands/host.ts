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

const hostInitOptionsSchema = z
  .object({
    target: z.string().min(1),
    iface: z.string().min(1).optional(),
    listenPort: z.coerce.number().int().min(1).max(65535).default(51820),
    hostAddress: z.string().min(1).default('10.0.0.1/24'),
    tunnelSubnet: z.string().min(1).default('10.0.0.0/24'),
    internetIface: z.string().min(1).optional(),
    endpoint: z.string().min(1).optional(),
    createClient: z.string().min(1).optional(),
    clientIp: z.string().min(1).optional(),
    dns: z.string().min(1).default('1.1.1.1, 8.8.8.8'),
    force: z.boolean().default(false),
    skipPackageInstall: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.createClient && !value.clientIp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--client-ip wajib saat --create-client dipakai',
      });
    }
  });

function buildClientConfigText(params: {
  clientPrivateKey: string;
  clientAddress: string;
  hostPublicKey: string;
  endpoint: string;
  listenPort: number;
  dns: string;
}): string {
  return [
    '[Interface]',
    `PrivateKey = ${params.clientPrivateKey}`,
    `Address = ${params.clientAddress}`,
    `DNS = ${params.dns}`,
    'Table = off',
    'PostUp  = /etc/wireguard/tunnel-up.sh %i',
    'PreDown = /etc/wireguard/tunnel-down.sh %i',
    '',
    '[Peer]',
    `PublicKey = ${params.hostPublicKey}`,
    `Endpoint = ${params.endpoint}:${params.listenPort}`,
    'AllowedIPs = 0.0.0.0/0',
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}

export function registerHostCommands(program: Command): void {
  const host = program.command('host').description('Operasi setup host WireGuard');

  host
    .command('init')
    .description('Setup host WireGuard + opsional buat profil client baru')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .option('--iface <iface>', 'Override interface WireGuard (default dari inventory)')
    .option('--listen-port <port>', 'ListenPort host', '51820')
    .option('--host-address <cidr>', 'Alamat tunnel host', '10.0.0.1/24')
    .option('--tunnel-subnet <cidr>', 'Subnet tunnel untuk NAT rule', '10.0.0.0/24')
    .option('--internet-iface <iface>', 'Override interface internet host')
    .option('--endpoint <host>', 'IP/domain endpoint host untuk profile client')
    .option('--create-client <name>', 'Sekalian buat profile client baru')
    .option('--client-ip <cidr>', 'Alamat tunnel client, contoh: 10.0.0.2/32')
    .option('--dns <dns>', 'DNS client profile', '1.1.1.1, 8.8.8.8')
    .option('--force', 'Overwrite wg config meskipun sudah ada')
    .option('--skip-package-install', 'Lewati apt install package')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = hostInitOptionsSchema.parse(rawOptions);
      const server = await getServerByName(options.target);

      assertServerRole(server, 'host');
      assertRootUser(server);

      const wgInterface = options.iface || server.wgInterface;
      const endpoint = options.endpoint || server.host;
      const installBlock = options.skipPackageInstall
        ? 'echo "SKIP_PKG_INSTALL=1"'
        : 'apt-get update -y >/dev/null && apt-get install -y wireguard iptables iproute2 >/dev/null';

      const setupOutput = await runRemoteChecked(
        server,
        `
set -euo pipefail
WG_IFACE=${shellEscape(wgInterface)}
LISTEN_PORT=${shellEscape(String(options.listenPort))}
HOST_ADDRESS=${shellEscape(options.hostAddress)}
TUNNEL_SUBNET=${shellEscape(options.tunnelSubnet)}
INTERNET_IFACE_OVERRIDE=${shellEscape(options.internetIface || '')}
FORCE_WRITE=${shellEscape(options.force ? '1' : '0')}
CONF_PATH="/etc/wireguard/\${WG_IFACE}.conf"
HOST_ENDPOINT=${shellEscape(endpoint)}

${installBlock}

install -d -m 700 /etc/wireguard
if [[ ! -f /etc/wireguard/server.key || ! -f /etc/wireguard/server.pub ]]; then
  umask 077
  wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
fi

cat >/etc/sysctl.d/99-wireguard-ip-forward.conf <<'EOF_SYSCTL'
net.ipv4.ip_forward=1
EOF_SYSCTL
sysctl --system >/dev/null

if [[ -n "$INTERNET_IFACE_OVERRIDE" ]]; then
  INTERNET_IFACE="$INTERNET_IFACE_OVERRIDE"
else
  INTERNET_IFACE="$(ip -4 route show default | head -1 | awk '{print $5}')"
fi

if [[ -z "$INTERNET_IFACE" ]]; then
  echo "ERROR=Tidak bisa mendeteksi interface internet host"
  exit 1
fi

if [[ ! -f "$CONF_PATH" || "$FORCE_WRITE" == "1" ]]; then
  HOST_PRIVATE_KEY="$(cat /etc/wireguard/server.key)"
  cat >"$CONF_PATH" <<EOF_CONF
[Interface]
PrivateKey = $HOST_PRIVATE_KEY
Address = $HOST_ADDRESS
ListenPort = $LISTEN_PORT
PostUp = iptables -t nat -A POSTROUTING -s $TUNNEL_SUBNET ! -o %i -j MASQUERADE
PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s $TUNNEL_SUBNET ! -o %i -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
EOF_CONF
fi

chmod 600 "$CONF_PATH"
systemctl enable wg-quick@"$WG_IFACE" >/dev/null 2>&1 || true
systemctl restart wg-quick@"$WG_IFACE"

echo "HOST_PUBLIC_KEY=$(cat /etc/wireguard/server.pub)"
echo "HOST_WG_IFACE=$WG_IFACE"
echo "HOST_ENDPOINT=$HOST_ENDPOINT"
echo "HOST_LISTEN_PORT=$LISTEN_PORT"
`,
      );

      const setupData = parseKeyValueLines(setupOutput);
      const hostPublicKey = setupData.HOST_PUBLIC_KEY;
      if (!hostPublicKey) {
        throw new AppError('Host public key tidak ditemukan dari hasil setup');
      }

      console.log(`Host ${server.name} siap. Public key: ${hostPublicKey}`);

      if (!options.createClient || !options.clientIp) {
        return;
      }

      const createClientOutput = await runRemoteChecked(
        server,
        `
set -euo pipefail
WG_IFACE=${shellEscape(wgInterface)}
CLIENT_NAME=${shellEscape(options.createClient)}
CLIENT_IP=${shellEscape(options.clientIp)}
CONF_PATH="/etc/wireguard/\${WG_IFACE}.conf"
CLIENT_DIR="/etc/wireguard/clients"
CLIENT_KEY="\${CLIENT_DIR}/\${CLIENT_NAME}.key"
CLIENT_PUB="\${CLIENT_DIR}/\${CLIENT_NAME}.pub"

install -d -m 700 "$CLIENT_DIR"

if [[ ! -f "$CLIENT_KEY" || ! -f "$CLIENT_PUB" ]]; then
  umask 077
  wg genkey | tee "$CLIENT_KEY" | wg pubkey > "$CLIENT_PUB"
fi

CLIENT_PRIVATE_KEY="$(cat "$CLIENT_KEY")"
CLIENT_PUBLIC_KEY="$(cat "$CLIENT_PUB")"

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
`,
      );

      const clientData = parseKeyValueLines(createClientOutput);
      if (!clientData.CLIENT_PRIVATE_KEY || !clientData.CLIENT_PUBLIC_KEY) {
        throw new AppError('Gagal membuat credential client di host');
      }

      const clientConfig = buildClientConfigText({
        clientPrivateKey: clientData.CLIENT_PRIVATE_KEY,
        clientAddress: clientData.CLIENT_IP || options.clientIp,
        hostPublicKey,
        endpoint,
        listenPort: options.listenPort,
        dns: options.dns,
      });

      console.log('');
      console.log(`Client "${clientData.CLIENT_NAME || options.createClient}" berhasil dibuat di host.`);
      console.log('Salin config berikut ke /etc/wireguard/wg0.conf di VPS client:');
      console.log('--- BEGIN CLIENT CONFIG ---');
      console.log(clientConfig);
      console.log('--- END CLIENT CONFIG ---');
    });
}
