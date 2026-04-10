import { spawn } from 'node:child_process';
import process from 'node:process';

import blessed from 'blessed';

import { AppError } from '../core/errors';
import { loadInventory } from '../core/inventory/store';

function appendLog(log: blessed.Widgets.Log, message: string): void {
  log.add(message);
  log.screen.render();
}

async function askInput(
  screen: blessed.Widgets.Screen,
  label: string,
  initialValue: string = '',
): Promise<string | null> {
  const prompt = blessed.prompt({
    parent: screen,
    border: 'line',
    height: 9,
    width: '70%',
    top: 'center',
    left: 'center',
    label: ' Input ',
    tags: true,
    keys: true,
    vi: true,
    hidden: true,
  });

  return new Promise((resolve) => {
    prompt.input(label, initialValue, (_err, value) => {
      prompt.destroy();
      screen.render();
      if (value === null || value === undefined) {
        resolve(null);
        return;
      }
      resolve(String(value));
    });
  });
}

async function askYesNo(screen: blessed.Widgets.Screen, question: string): Promise<boolean> {
  const dialog = blessed.question({
    parent: screen,
    border: 'line',
    height: 9,
    width: '70%',
    top: 'center',
    left: 'center',
    label: ' Konfirmasi ',
    tags: true,
    keys: true,
    vi: true,
    hidden: true,
  });

  return new Promise((resolve) => {
    dialog.ask(question, (answer) => {
      dialog.destroy();
      screen.render();
      resolve(Boolean(answer));
    });
  });
}

function buildCommandInvocation(args: string[]): { command: string; commandArgs: string[] } {
  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);

  if (isPkg) {
    return { command: 'wgm', commandArgs: args };
  }

  return {
    command: process.execPath,
    commandArgs: [process.argv[1], ...args],
  };
}

async function runWgmCommand(
  screen: blessed.Widgets.Screen,
  log: blessed.Widgets.Log,
  args: string[],
): Promise<number> {
  const { command, commandArgs } = buildCommandInvocation(args);
  appendLog(log, `$ wgm ${args.join(' ')}`);

  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('error', (error: Error) => {
      appendLog(log, `ERROR spawn: ${error.message}`);
      resolve(1);
    });

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd();
      if (text) {
        for (const line of text.split('\n')) {
          appendLog(log, line);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd();
      if (text) {
        for (const line of text.split('\n')) {
          appendLog(log, line);
        }
      }
    });

    child.on('close', (code) => {
      appendLog(log, `Exit code: ${code ?? 0}`);
      resolve(code ?? 0);
    });
  });
}

function pushOption(args: string[], flag: string, value?: string | null): void {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  args.push(flag, trimmed);
}

export async function startTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AppError('wgm tui harus dijalankan di terminal interaktif (TTY).');
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: 'WireGuard Manager TUI',
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: ' WireGuard Manager TUI  |  Arrow: navigasi  Enter: pilih  Esc/q: keluar ',
    tags: false,
    style: {
      fg: 'white',
      bg: 'blue',
    },
  });

  const menu = blessed.list({
    parent: screen,
    label: ' Menu ',
    top: 3,
    left: 0,
    width: '35%',
    height: '100%-3',
    border: 'line',
    keys: true,
    mouse: true,
    vi: true,
    style: {
      selected: {
        bg: 'green',
        fg: 'black',
      },
      item: {
        fg: 'white',
      },
      border: {
        fg: 'cyan',
      },
    },
    items: [
      'Inventory: Init',
      'Inventory: List Servers',
      'Inventory: Add/Update Server',
      'Inventory: Remove Server',
      'Host: Init (Gateway)',
      'Client: Init (Connect to Host)',
      'Tunnel: Status',
      'Tunnel: Up',
      'Tunnel: Down',
      'Tunnel: Restart',
      'Peer: List',
      'Peer: Add',
      'Peer: Remove',
      'Doctor: Quick',
      'Uninstall WGM',
      'Help: Command Overview',
      'Exit',
    ],
  });

  const log = blessed.log({
    parent: screen,
    label: ' Output ',
    top: 3,
    left: '35%',
    width: '65%',
    height: '100%-3',
    border: 'line',
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    style: {
      border: {
        fg: 'cyan',
      },
    },
  });

  screen.append(header);
  screen.append(menu);
  screen.append(log);

  menu.focus();

  let running = false;

  menu.on('select', async (_item, index) => {
    if (running) return;
    running = true;
    menu.setLabel(' Menu (Running...) ');
    screen.render();

    try {
      switch (index) {
        case 0: {
          await runWgmCommand(screen, log, ['inventory', 'init']);
          break;
        }
        case 1: {
          const inventory = await loadInventory();
          appendLog(log, '--- Inventory Servers ---');
          if (inventory.servers.length === 0) {
            appendLog(log, 'Inventory kosong.');
          } else {
            for (const server of inventory.servers) {
              appendLog(
                log,
                `${server.name} | ${server.role} | ${server.user}@${server.host}:${server.port} | ${server.wgInterface}`,
              );
            }
          }
          await runWgmCommand(screen, log, ['inventory', 'list']);
          break;
        }
        case 2: {
          const name = await askInput(screen, 'Nama server (--name):');
          if (!name) break;
          const role = await askInput(screen, 'Role host/client (--role):', 'client');
          if (!role) break;
          const host = await askInput(screen, 'Host/IP (--host):');
          if (!host) break;
          const user = await askInput(screen, 'SSH user (--user):', 'root');
          if (!user) break;
          const port = await askInput(screen, 'SSH port (--port):', '22');
          if (!port) break;
          const iface = await askInput(screen, 'WireGuard iface (--iface):', 'wg0');
          if (!iface) break;
          const auth = await askInput(screen, 'Auth method agent/key/password (--auth):', 'agent');
          if (!auth) break;

          const args = [
            'inventory',
            'add',
            '--name',
            name.trim(),
            '--role',
            role.trim(),
            '--host',
            host.trim(),
            '--user',
            user.trim(),
            '--port',
            port.trim(),
            '--iface',
            iface.trim(),
            '--auth',
            auth.trim(),
          ];

          if (auth.trim() === 'key') {
            const keyPath = await askInput(screen, 'Path private key (--key-path):', '/root/.ssh/id_rsa');
            if (!keyPath) break;
            args.push('--key-path', keyPath.trim());
            const passEnv = await askInput(screen, 'ENV passphrase (opsional --passphrase-env):');
            pushOption(args, '--passphrase-env', passEnv);
          } else if (auth.trim() === 'password') {
            const passwordEnv = await askInput(screen, 'ENV password (--password-env):');
            if (!passwordEnv) break;
            args.push('--password-env', passwordEnv.trim());
          }

          const tags = await askInput(screen, 'Tags opsional comma-separated (--tags):');
          pushOption(args, '--tags', tags);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 3: {
          const name = await askInput(screen, 'Nama server yang dihapus (--name):');
          if (!name) break;
          await runWgmCommand(screen, log, ['inventory', 'remove', '--name', name.trim()]);
          break;
        }
        case 4: {
          const target = await askInput(screen, 'Target host di inventory (--target):');
          if (!target) break;
          const endpoint = await askInput(screen, 'Endpoint host (opsional --endpoint):');
          const listenPort = await askInput(screen, 'Listen port (--listen-port):', '51820');
          if (!listenPort) break;
          const hostAddress = await askInput(screen, 'Host tunnel address (--host-address):', '10.0.0.1/24');
          if (!hostAddress) break;
          const subnet = await askInput(screen, 'Tunnel subnet (--tunnel-subnet):', '10.0.0.0/24');
          if (!subnet) break;

          const args = [
            'host',
            'init',
            '--target',
            target.trim(),
            '--listen-port',
            listenPort.trim(),
            '--host-address',
            hostAddress.trim(),
            '--tunnel-subnet',
            subnet.trim(),
          ];
          pushOption(args, '--endpoint', endpoint);

          const createClient = await askYesNo(screen, 'Sekalian buat client profile di host?');
          if (createClient) {
            const clientName = await askInput(screen, 'Nama client baru (--create-client):');
            const clientIp = await askInput(screen, 'IP client tunnel (--client-ip):', '10.0.0.2/32');
            if (clientName && clientIp) {
              args.push('--create-client', clientName.trim(), '--client-ip', clientIp.trim());
            }
          }

          await runWgmCommand(screen, log, args);
          break;
        }
        case 5: {
          const target = await askInput(screen, 'Target client di inventory (--target):');
          if (!target) break;
          const hostTarget = await askInput(screen, 'Target host di inventory (--host-target):');
          if (!hostTarget) break;
          const clientIp = await askInput(screen, 'IP client tunnel (--client-ip):', '10.0.0.2/32');
          if (!clientIp) break;
          const endpoint = await askInput(screen, 'Endpoint host (opsional --endpoint):');
          const listenPort = await askInput(screen, 'Listen port host (--listen-port):', '51820');
          if (!listenPort) break;

          const args = [
            'client',
            'init',
            '--target',
            target.trim(),
            '--host-target',
            hostTarget.trim(),
            '--client-ip',
            clientIp.trim(),
            '--listen-port',
            listenPort.trim(),
          ];
          pushOption(args, '--endpoint', endpoint);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 6:
        case 7:
        case 8:
        case 9: {
          const target = await askInput(screen, 'Target server (--target):');
          if (!target) break;
          const iface = await askInput(screen, 'Interface opsional (--iface):');
          const action = ['status', 'up', 'down', 'restart'][index - 6];
          const args = ['tunnel', action, '--target', target.trim()];
          pushOption(args, '--iface', iface);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 10: {
          const target = await askInput(screen, 'Target host (--target):');
          if (!target) break;
          const iface = await askInput(screen, 'Interface opsional (--iface):');
          const args = ['peer', 'list', '--target', target.trim()];
          pushOption(args, '--iface', iface);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 11: {
          const target = await askInput(screen, 'Target host (--target):');
          if (!target) break;
          const pubKey = await askInput(screen, 'Public key peer (--public-key):');
          if (!pubKey) break;
          const allowedIp = await askInput(screen, 'Allowed IP (--allowed-ip):', '10.0.0.2/32');
          if (!allowedIp) break;
          const iface = await askInput(screen, 'Interface opsional (--iface):');
          const args = [
            'peer',
            'add',
            '--target',
            target.trim(),
            '--public-key',
            pubKey.trim(),
            '--allowed-ip',
            allowedIp.trim(),
          ];
          pushOption(args, '--iface', iface);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 12: {
          const target = await askInput(screen, 'Target host (--target):');
          if (!target) break;
          const pubKey = await askInput(screen, 'Public key peer (--public-key):');
          if (!pubKey) break;
          const iface = await askInput(screen, 'Interface opsional (--iface):');
          const args = ['peer', 'remove', '--target', target.trim(), '--public-key', pubKey.trim()];
          pushOption(args, '--iface', iface);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 13: {
          const target = await askInput(screen, 'Target server (--target):');
          if (!target) break;
          const iface = await askInput(screen, 'Interface opsional (--iface):');
          const args = ['doctor', 'quick', '--target', target.trim()];
          pushOption(args, '--iface', iface);
          await runWgmCommand(screen, log, args);
          break;
        }
        case 14: {
          const confirm = await askYesNo(screen, 'Yakin uninstall wgm dari mesin ini?');
          if (!confirm) break;
          const purge = await askYesNo(screen, 'Hapus juga config ~/.wg-manager?');
          const args = ['uninstall', '--yes'];
          if (purge) args.push('--purge-config');
          await runWgmCommand(screen, log, args);
          break;
        }
        case 15: {
          appendLog(log, 'Contoh command:');
          appendLog(log, 'wgm inventory add --name node11 --role host --host 1.2.3.4 --auth key --key-path /root/.ssh/id_rsa');
          appendLog(log, 'wgm host init --target node11 --endpoint 1.2.3.4');
          appendLog(log, 'wgm client init --target node7 --host-target node11 --client-ip 10.0.0.2/32');
          appendLog(log, 'wgm tunnel status --target node11');
          appendLog(log, 'wgm doctor quick --target node7');
          break;
        }
        default:
          screen.destroy();
          return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(log, `ERROR: ${message}`);
    } finally {
      running = false;
      menu.setLabel(' Menu ');
      menu.focus();
      screen.render();
    }
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    screen.destroy();
  });

  screen.render();
}
