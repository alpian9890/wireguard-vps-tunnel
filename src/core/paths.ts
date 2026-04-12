import path from 'node:path';

export const DEFAULT_CONFIG_DIR = '/etc/wgm';
export const DEFAULT_INVENTORY_PATH = path.join(DEFAULT_CONFIG_DIR, 'servers.json');
export const DEFAULT_WINDOWS_PEERS_PATH = path.join(DEFAULT_CONFIG_DIR, 'windows-peers.json');
