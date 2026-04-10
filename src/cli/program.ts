import { Command } from 'commander';

import { registerClientCommands } from './commands/client';
import { registerDoctorCommands } from './commands/doctor';
import { registerHostCommands } from './commands/host';
import { registerInventoryCommands } from './commands/inventory';
import { registerPeerCommands } from './commands/peer';
import { registerTunnelCommands } from './commands/tunnel';
import { registerTuiCommand } from './commands/tui';

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name('wgm')
    .description('WireGuard Manager CLI/TUI')
    .version('0.1.0-alpha')
    .showHelpAfterError();

  registerInventoryCommands(program);
  registerTunnelCommands(program);
  registerPeerCommands(program);
  registerDoctorCommands(program);
  registerHostCommands(program);
  registerClientCommands(program);
  registerTuiCommand(program);

  await program.parseAsync(argv);
}

