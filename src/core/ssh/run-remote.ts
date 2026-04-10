import fs from 'node:fs/promises';

import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';

import { AppError } from '../errors';
import type { Server } from '../inventory/schema';

export interface RemoteRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function buildAuth(server: Server): Promise<Partial<ConnectConfig>> {
  if (server.auth.method === 'agent') {
    const agent = process.env.SSH_AUTH_SOCK;
    if (!agent) {
      throw new AppError(`SSH agent tidak tersedia untuk target "${server.name}"`);
    }
    return { agent };
  }

  if (server.auth.method === 'key') {
    const privateKey = await fs.readFile(server.auth.privateKeyPath, 'utf-8');
    const passphrase = server.auth.passphraseEnv
      ? process.env[server.auth.passphraseEnv]
      : undefined;
    return {
      privateKey,
      passphrase,
    };
  }

  const password = process.env[server.auth.passwordEnv];
  if (!password) {
    throw new AppError(
      `ENV password "${server.auth.passwordEnv}" tidak ditemukan untuk target "${server.name}"`,
    );
  }
  return { password };
}

export async function runRemote(
  server: Server,
  command: string,
  timeoutMs: number = 60_000,
): Promise<RemoteRunResult> {
  const conn = new Client();
  const auth = await buildAuth(server);
  const wrappedCommand = `bash -lc ${shellEscape(command)}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(new AppError(`Timeout menjalankan command di ${server.name}`));
    }, timeoutMs);

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      fn();
    };

    conn
      .on('ready', () => {
        conn.exec(wrappedCommand, (error, stream) => {
          if (error) {
            done(() => reject(new AppError(`Gagal exec command: ${error.message}`)));
            return;
          }

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on('close', (code: number | undefined) => {
            done(() => {
              resolve({
                stdout: stdout.trimEnd(),
                stderr: stderr.trimEnd(),
                code: code ?? 0,
              });
            });
          });
        });
      })
      .on('error', (error: Error) => {
        done(() => reject(new AppError(`Koneksi SSH gagal ke ${server.name}: ${error.message}`)));
      })
      .connect({
        host: server.host,
        port: server.port,
        username: server.user,
        ...auth,
      });
  });
}

