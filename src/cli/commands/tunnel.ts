import { Command } from 'commander';

import { runRemote } from '../../core/ssh/run-remote';
import { getServerByName, getSudoPrefix } from './shared';

function printRemoteOutput(stdout: string, stderr: string): void {
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

export function registerTunnelCommands(program: Command): void {
  const tunnel = program.command('tunnel').description('Kontrol tunnel WireGuard di target server');

  tunnel
    .command('status')
    .description('Cek status tunnel, route default, dan service')
    .requiredOption('--target <name>', 'Nama target di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);

      const command = [
        `echo "=== ${server.name} (${wgInterface}) ==="`,
        `${sudo}wg show ${wgInterface} 2>/dev/null || echo "WireGuard tidak aktif"`,
        `echo`,
        `echo "=== systemd ==="`,
        `${sudo}systemctl is-active wg-quick@${wgInterface} || true`,
        `${sudo}systemctl is-enabled wg-quick@${wgInterface} || true`,
        `echo`,
        `echo "=== default route ==="`,
        `ip -4 route show default | head -1 || true`,
      ].join(' ; ');

      const result = await runRemote(server, command);
      printRemoteOutput(result.stdout, result.stderr);
    });

  tunnel
    .command('up')
    .description('Nyalakan service wg-quick@iface di target')
    .requiredOption('--target <name>', 'Nama target di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);
      const result = await runRemote(
        server,
        `${sudo}systemctl start wg-quick@${wgInterface} && ${sudo}systemctl status wg-quick@${wgInterface} --no-pager -n 20`,
      );
      printRemoteOutput(result.stdout, result.stderr);
    });

  tunnel
    .command('down')
    .description('Matikan service wg-quick@iface di target')
    .requiredOption('--target <name>', 'Nama target di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);
      const result = await runRemote(
        server,
        `${sudo}systemctl stop wg-quick@${wgInterface} && ${sudo}systemctl is-active wg-quick@${wgInterface} || true`,
      );
      printRemoteOutput(result.stdout, result.stderr);
    });

  tunnel
    .command('restart')
    .description('Restart service wg-quick@iface di target')
    .requiredOption('--target <name>', 'Nama target di inventory')
    .option('--iface <iface>', 'Override interface WireGuard')
    .action(async (options: { target: string; iface?: string }) => {
      const server = await getServerByName(options.target);
      const wgInterface = options.iface || server.wgInterface;
      const sudo = getSudoPrefix(server);
      const result = await runRemote(
        server,
        `${sudo}systemctl restart wg-quick@${wgInterface} && ${sudo}wg show ${wgInterface}`,
      );
      printRemoteOutput(result.stdout, result.stderr);
    });
}

