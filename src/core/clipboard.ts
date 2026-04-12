import { spawnSync } from 'node:child_process';

import { AppError } from './errors';

interface ClipboardTool {
  command: string;
  args: string[];
  label: string;
}

const CANDIDATE_TOOLS: ClipboardTool[] = [
  { command: 'pbcopy', args: [], label: 'pbcopy' },
  { command: 'wl-copy', args: [], label: 'wl-copy' },
  { command: 'xclip', args: ['-selection', 'clipboard'], label: 'xclip' },
  { command: 'xsel', args: ['--clipboard', '--input'], label: 'xsel' },
  { command: 'termux-clipboard-set', args: [], label: 'termux-clipboard-set' },
  { command: 'clip.exe', args: [], label: 'clip.exe' },
  { command: 'clip', args: [], label: 'clip' },
];

export function copyTextToClipboard(text: string): string {
  const errors: string[] = [];

  for (const tool of CANDIDATE_TOOLS) {
    const result = spawnSync(tool.command, tool.args, {
      input: text,
      encoding: 'utf-8',
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      continue;
    }

    if (result.status === 0) {
      return tool.label;
    }

    const stderr = (result.stderr || '').toString().trim();
    errors.push(`${tool.label}: ${stderr || `exit code ${result.status ?? 1}`}`);
  }

  const detail =
    errors.length > 0 ? ` Detail: ${errors.join(' | ')}` : ' Tidak ada tool clipboard yang tersedia di sistem.';
  throw new AppError(`Gagal copy ke clipboard.${detail}`);
}
