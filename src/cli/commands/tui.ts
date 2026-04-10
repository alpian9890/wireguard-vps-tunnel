import { Command } from 'commander';

import { startTui } from '../../tui/app';

export function registerTuiCommand(program: Command): void {
  program
    .command('tui')
    .description('Jalankan antarmuka TUI (arrow/enter/esc)')
    .action(async () => {
      await startTui();
    });
}

