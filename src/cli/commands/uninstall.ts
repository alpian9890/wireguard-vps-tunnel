import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import process from 'node:process';

import { Command } from 'commander';

import { AppError } from '../../core/errors';
import { DEFAULT_CONFIG_DIR } from '../../core/paths';

interface UninstallOptions {
  yes?: boolean;
  purgeConfig?: boolean;
  noSudo?: boolean;
  binaryPath?: string;
}

const LEGACY_BINARY_PATH = '/usr/local/bin/wgm';

function resolveBinaryPath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;

  if ((process as NodeJS.Process & { pkg?: unknown }).pkg) {
    return process.execPath;
  }

  return '/usr/bin/wgm';
}

async function confirmUninstall(options: { binaryPath: string; purgeConfig: boolean }): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AppError('Konfirmasi uninstall butuh terminal interaktif. Gunakan --yes untuk non-interaktif.');
  }

  console.log('Konfirmasi uninstall WGM');
  console.log(`- Hapus binary: ${options.binaryPath}`);
  console.log(`- Hapus config (${DEFAULT_CONFIG_DIR}): ${options.purgeConfig ? 'YA' : 'TIDAK'}`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question('Lanjutkan uninstall? [y/N]: ');
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function removeBinary(binaryPath: string, noSudo: boolean): Promise<void> {
  if (binaryPath === '/' || binaryPath.trim() === '') {
    throw new AppError('Path binary tidak valid untuk dihapus.');
  }

  try {
    await fs.unlink(binaryPath);
    return;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new AppError(`Binary tidak ditemukan di ${binaryPath}`);
    }
    if ((code === 'EACCES' || code === 'EPERM') && !noSudo) {
      const result = spawnSync('sudo', ['rm', '-f', binaryPath], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new AppError(`Gagal menghapus binary via sudo (exit code ${result.status ?? 1})`);
      }
      return;
    }
    throw new AppError(`Gagal menghapus binary: ${(error as Error).message}`);
  }
}

async function removeOptionalBinary(binaryPath: string, noSudo: boolean): Promise<boolean> {
  try {
    await fs.unlink(binaryPath);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    if ((code === 'EACCES' || code === 'EPERM') && !noSudo) {
      const result = spawnSync('sudo', ['rm', '-f', binaryPath], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new AppError(`Gagal menghapus binary optional via sudo: ${binaryPath}`);
      }
      return true;
    }
    throw new AppError(`Gagal menghapus binary optional ${binaryPath}: ${(error as Error).message}`);
  }
}

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Uninstall aplikasi wgm dari mesin ini')
    .option('--yes', 'Lewati konfirmasi interaktif')
    .option('--purge-config', `Hapus juga ${DEFAULT_CONFIG_DIR}`)
    .option('--no-sudo', 'Jangan gunakan sudo fallback saat hapus binary')
    .option('--binary-path <path>', 'Override path binary wgm yang dihapus')
    .action(async (options: UninstallOptions) => {
      const binaryPath = resolveBinaryPath(options.binaryPath);
      const purgeConfig = Boolean(options.purgeConfig);

      if (!options.yes) {
        const accepted = await confirmUninstall({ binaryPath, purgeConfig });
        if (!accepted) {
          console.log('Uninstall dibatalkan.');
          return;
        }
      }

      await removeBinary(binaryPath, Boolean(options.noSudo));
      if (binaryPath !== LEGACY_BINARY_PATH) {
        const removedLegacy = await removeOptionalBinary(LEGACY_BINARY_PATH, Boolean(options.noSudo));
        if (removedLegacy) {
          console.log(`Binary lama juga dihapus: ${LEGACY_BINARY_PATH}`);
        }
      }

      if (purgeConfig) {
        await fs.rm(DEFAULT_CONFIG_DIR, { recursive: true, force: true });
        console.log(`Config dihapus: ${DEFAULT_CONFIG_DIR}`);
      }

      console.log(`WGM berhasil dihapus dari ${binaryPath}`);
    });
}
