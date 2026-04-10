import { AppError } from '../../core/errors';
import { findServer, loadInventory } from '../../core/inventory/store';
import type { Server } from '../../core/inventory/schema';
import { runRemote } from '../../core/ssh/run-remote';

export async function getServerByName(name: string): Promise<Server> {
  const inventory = await loadInventory();
  const server = findServer(inventory, name);
  if (!server) {
    throw new AppError(`Target "${name}" tidak ditemukan di inventory`);
  }
  return server;
}

export function getSudoPrefix(server: Server): string {
  return server.user === 'root' ? '' : 'sudo ';
}

export function assertServerRole(server: Server, expected: 'host' | 'client'): void {
  if (server.role !== expected) {
    throw new AppError(`Target "${server.name}" harus role "${expected}", sekarang "${server.role}"`);
  }
}

export function assertRootUser(server: Server): void {
  if (server.user !== 'root') {
    throw new AppError(
      `Target "${server.name}" harus memakai user root untuk operasi init (current: ${server.user})`,
    );
  }
}

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseKeyValueLines(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export async function runRemoteChecked(
  server: Server,
  command: string,
  timeoutMs: number = 120_000,
): Promise<string> {
  const result = await runRemote(server, command, timeoutMs);
  if (result.code !== 0) {
    const detail = result.stderr || result.stdout || `exit code ${result.code}`;
    throw new AppError(`Command gagal di ${server.name}: ${detail}`);
  }
  return result.stdout;
}
