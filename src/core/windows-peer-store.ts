import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AppError } from './errors';
import { DEFAULT_WINDOWS_PEERS_PATH } from './paths';

const windowsPeerRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  target: z.string().min(1),
  iface: z.string().min(1),
  clientName: z.string().min(1),
  clientIp: z.string().min(1),
  endpoint: z.string().min(1),
  listenPort: z.number().int().min(1).max(65535),
  dns: z.string().min(1),
  allowedIps: z.string().min(1),
  keepalive: z.number().int().min(0).max(65535),
  hostPublicKey: z.string().min(1),
  clientPublicKey: z.string().min(1),
  config: z.string().min(1),
});

const windowsPeerStoreSchema = z.object({
  version: z.literal(1),
  records: z.array(windowsPeerRecordSchema).default([]),
});

export type WindowsPeerRecord = z.infer<typeof windowsPeerRecordSchema>;
type WindowsPeerStore = z.infer<typeof windowsPeerStoreSchema>;

function getStorePath(): string {
  return process.env.WGM_WINDOWS_PEERS_PATH || DEFAULT_WINDOWS_PEERS_PATH;
}

function slugify(value: string): string {
  const lower = value.trim().toLowerCase();
  const slug = lower.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || 'peer';
}

function makeRecordId(target: string, clientName: string): string {
  return `${slugify(target)}__${slugify(clientName)}`;
}

async function ensureStoreDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

async function loadStore(): Promise<WindowsPeerStore> {
  const filePath = getStorePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return windowsPeerStoreSchema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, records: [] };
    }
    if (error instanceof Error) {
      throw new AppError(`Gagal membaca data peer Windows: ${error.message}`);
    }
    throw new AppError('Gagal membaca data peer Windows');
  }
}

async function saveStore(store: WindowsPeerStore): Promise<string> {
  const filePath = getStorePath();
  await ensureStoreDir(filePath);
  const parsed = windowsPeerStoreSchema.parse(store);
  parsed.records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return filePath;
}

export async function upsertWindowsPeerRecord(
  input: Omit<WindowsPeerRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<{ record: WindowsPeerRecord; filePath: string }> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const id = makeRecordId(input.target, input.clientName);
  const existing = store.records.find((record) => record.id === id);

  const record: WindowsPeerRecord = {
    ...input,
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const records = store.records.filter((item) => item.id !== id);
  records.push(record);
  const filePath = await saveStore({ version: 1, records });
  return { record, filePath };
}

export async function listWindowsPeerRecords(target?: string): Promise<WindowsPeerRecord[]> {
  const store = await loadStore();
  const filtered = target
    ? store.records.filter((record) => record.target === target)
    : store.records.slice();
  filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return filtered;
}

export async function findWindowsPeerRecordById(id: string): Promise<WindowsPeerRecord | undefined> {
  const store = await loadStore();
  return store.records.find((record) => record.id === id);
}
