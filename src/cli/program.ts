import { Command } from 'commander';
import packageJson from '../../package.json';

import { registerClientCommands } from './commands/client';
import { registerDoctorCommands } from './commands/doctor';
import { registerHostCommands } from './commands/host';
import { registerInventoryCommands } from './commands/inventory';
import { registerPeerCommands } from './commands/peer';
import { registerTunnelCommands } from './commands/tunnel';
import { registerTuiCommand } from './commands/tui';
import { registerUninstallCommand } from './commands/uninstall';

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name('wgm')
    .description('WireGuard Manager CLI/TUI')
    .version(packageJson.version)
    .showHelpAfterError();

  registerInventoryCommands(program);
  registerTunnelCommands(program);
  registerPeerCommands(program);
  registerDoctorCommands(program);
  registerHostCommands(program);
  registerClientCommands(program);
  registerTuiCommand(program);
  registerUninstallCommand(program);

  await program.parseAsync(argv);
}
