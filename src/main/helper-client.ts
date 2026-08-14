import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { API_VERSION } from '../shared/contracts.js';

const PIPE_PATH = '\\\\.\\pipe\\activity-journal-v1';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

interface PipeResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export class HelperClient {
  private helper?: ChildProcess;

  start(): void {
    if (process.platform !== 'win32' || this.helper) return;

    const helperPath = app.isPackaged
      ? join(process.resourcesPath, 'native', 'ActivityJournal.Helper.exe')
      : join(app.getAppPath(), 'native', 'publish', 'win-x64', 'ActivityJournal.Helper.exe');

    if (!existsSync(helperPath)) {
      console.warn(`Collector helper is not built: ${helperPath}`);
      return;
    }

    this.helper = spawn(helperPath, ['--collector'], {
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ACTIVITY_JOURNAL_DATA: app.getPath('userData') },
    });
    this.helper.once('exit', () => {
      this.helper = undefined;
    });
  }

  stop(): void {
    this.helper?.kill();
    this.helper = undefined;
  }

  async waitUntilReady(timeoutMs = 8_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        await this.request('status');
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw new Error('Collector helper did not become ready');
  }

  request<T>(command: string, payload?: unknown, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const socket = net.createConnection(PIPE_PATH);
      let buffer = '';
      let settled = false;

      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };

      const timeout = setTimeout(
        () => finish(new Error(`Collector request timed out: ${command}`)),
        timeoutMs,
      );
      socket.setEncoding('utf8');
      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ id, apiVersion: API_VERSION, command, payload })}\n`);
      });
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
          finish(new Error('Collector response exceeded size limit'));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as PipeResponse<T>;
          if (response.id !== id) throw new Error('Collector response ID mismatch');
          if (!response.ok) throw new Error(response.error || 'Collector request failed');
          finish(undefined, response.result);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.once('error', (error) => finish(error));
      socket.once('end', () => {
        if (!settled) finish(new Error('Collector closed the connection without a response'));
      });
    });
  }
}
