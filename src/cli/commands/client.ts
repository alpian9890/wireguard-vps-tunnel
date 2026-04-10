import { Command } from 'commander';

import { AppError } from '../../core/errors';

export function registerClientCommands(program: Command): void {
  const client = program.command('client').description('Operasi setup client WireGuard');

  client
    .command('init')
    .description('Setup client WireGuard (akan diimplementasikan penuh pada fase berikutnya)')
    .requiredOption('--target <name>', 'Nama target client di inventory')
    .action(() => {
      throw new AppError(
        'client init belum diimplementasikan penuh. Gunakan docs/03-setup-client.md untuk sementara.',
      );
    });
}

