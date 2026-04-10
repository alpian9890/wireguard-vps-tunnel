import { Command } from 'commander';

import { runRemote } from '../../core/ssh/run-remote';
import { getServerByName } from './shared';

function printRemoteOutput(stdout: string, stderr: string): void {
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

export function registerDoctorCommands(program: Command): void {
  const doctor = program.command('doctor').description('Diagnostik tunnel berdasarkan troubleshooting');

  doctor
    .command('quick')
    .description('Jalankan diagnostik cepat seperti docs/05-troubleshooting.md')
    .requiredOption('--target <name>', 'Nama target di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;

      const command = [
        'echo "=== 1. WireGuard Status ==="',
        `wg show ${wgInterface} 2>/dev/null || echo "WireGuard TIDAK aktif"`,
        'echo',
        'echo "=== 2. Interface ==="',
        `ip link show ${wgInterface} 2>/dev/null || echo "Interface ${wgInterface} TIDAK ada"`,
        'echo',
        'echo "=== 3. Default Route ==="',
        'ip route show default',
        'echo',
        'echo "=== 4. IP Terdeteksi ==="',
        'curl -4 -s --max-time 5 ifconfig.me || echo "Tidak bisa cek IP (timeout/error)"',
        'echo',
        'echo "=== 5. CONNMARK Rules ==="',
        'iptables -t mangle -L PREROUTING -n 2>/dev/null | grep -c CONNMARK || true',
        'echo',
        'echo "=== 6. Policy Routing ==="',
        'ip rule show | grep "fwmark 0xc8" || echo "IP rule fwmark 200 TIDAK ada"',
        'echo',
        'echo "=== 7. Routing Table 200 ==="',
        'ip route show table 200 2>/dev/null || echo "Table 200 KOSONG"',
        'echo',
        'echo "=== 8. State File ==="',
        `cat /run/wg-tunnel-${wgInterface}.state 2>/dev/null || echo "State file TIDAK ada"`,
      ].join(' ; ');

      const result = await runRemote(server, command);
      printRemoteOutput(result.stdout, result.stderr);
    });
}

