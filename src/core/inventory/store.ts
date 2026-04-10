import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../errors';
import { DEFAULT_INVENTORY_PATH } from '../paths';
import { inventorySchema, type Inventory, type Server } from './schema';

function getInventoryPath(): string {
  return process.env.WGM_INVENTORY_PATH || DEFAULT_INVENTORY_PATH;
}

async function ensureInventoryDir(filePath: string): Promise<void> {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

export function getDefaultInventory(): Inventory {
  return { version: 1, servers: [] };
}

export async function loadInventory(): Promise<Inventory> {
  const filePath = getInventoryPath();

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return inventorySchema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return getDefaultInventory();
    }
    if (error instanceof Error) {
      throw new AppError(`Gagal membaca inventory: ${error.message}`);
    }
    throw new AppError('Gagal membaca inventory');
  }
}

export async function saveInventory(inventory: Inventory): Promise<string> {
  const filePath = getInventoryPath();
  await ensureInventoryDir(filePath);

  const parsed = inventorySchema.parse(inventory);
  parsed.servers.sort((a, b) => a.name.localeCompare(b.name));

  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });

  return filePath;
}

export async function initInventoryIfMissing(): Promise<string> {
  const inventory = await loadInventory();
  return saveInventory(inventory);
}

export function findServer(inventory: Inventory, name: string): Server | undefined {
  return inventory.servers.find((server) => server.name === name);
}

export function upsertServer(inventory: Inventory, server: Server): Inventory {
  const servers = inventory.servers.filter((item) => item.name !== server.name);
  servers.push(server);
  return {
    ...inventory,
    servers,
  };
}

export function removeServer(inventory: Inventory, name: string): Inventory {
  return {
    ...inventory,
    servers: inventory.servers.filter((server) => server.name !== name),
  };
}

