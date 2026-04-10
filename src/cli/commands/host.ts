import { Command } from 'commander';

import { AppError } from '../../core/errors';

export function registerHostCommands(program: Command): void {
  const host = program.command('host').description('Operasi setup host WireGuard');

  host
    .command('init')
    .description('Setup host WireGuard (akan diimplementasikan penuh pada fase berikutnya)')
    .requiredOption('--target <name>', 'Nama target host di inventory')
    .action(() => {
      throw new AppError(
        'host init belum diimplementasikan penuh. Gunakan docs/02-setup-host.md untuk sementara.',
      );
    });
}

