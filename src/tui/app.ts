import blessed from 'blessed';

import { loadInventory } from '../core/inventory/store';

function appendLog(log: blessed.Widgets.Log, message: string): void {
  log.add(message);
  log.screen.render();
}

export async function startTui(): Promise<void> {
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
    items: ['Inventory: List Servers', 'Help: Command Overview', 'Exit'],
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

  menu.on('select', async (_item, index) => {
    if (index === 0) {
      const inventory = await loadInventory();
      appendLog(log, '--- Inventory Servers ---');
      if (inventory.servers.length === 0) {
        appendLog(log, 'Inventory kosong.');
        return;
      }
      for (const server of inventory.servers) {
        appendLog(
          log,
          `${server.name} | ${server.role} | ${server.user}@${server.host}:${server.port} | ${server.wgInterface}`,
        );
      }
      return;
    }

    if (index === 1) {
      appendLog(log, 'Contoh command:');
      appendLog(log, 'wgm inventory add --name node2 --role host --host 1.2.3.4 --auth agent');
      appendLog(log, 'wgm tunnel status --target node2');
      appendLog(log, 'wgm doctor quick --target node2');
      return;
    }

    screen.destroy();
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    screen.destroy();
  });

  screen.render();
}

