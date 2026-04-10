import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.wg-manager');
export const DEFAULT_INVENTORY_PATH = path.join(DEFAULT_CONFIG_DIR, 'servers.json');

