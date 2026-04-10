import { AppError } from '../../core/errors';
import { findServer, loadInventory } from '../../core/inventory/store';
import type { Server } from '../../core/inventory/schema';

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

