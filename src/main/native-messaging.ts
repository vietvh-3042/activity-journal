import { app } from 'electron';
import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const EXTENSION_ID = 'bkbaolcobjbcpjkbneipppmgmneemegf';
export const NATIVE_HOST_NAME = 'com.activity_journal.host';

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native', 'ActivityJournal.Helper.exe')
    : join(app.getAppPath(), 'native', 'publish', 'win-x64', 'ActivityJournal.Helper.exe');
}

export interface BrowserIntegrationResult {
  registered: boolean;
  extensionId: string;
  manifestPath: string;
}

export async function registerNativeMessagingHost(): Promise<BrowserIntegrationResult> {
  if (process.platform !== 'win32') throw new Error('Browser integration is only available on Windows');

  const hostDirectory = join(app.getPath('userData'), 'NativeMessagingHost');
  const manifestPath = join(hostDirectory, `${NATIVE_HOST_NAME}.json`);
  await access(helperPath());
  await mkdir(hostDirectory, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        name: NATIVE_HOST_NAME,
        description: 'Activity Journal browser bridge',
        path: helperPath(),
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      },
      null,
      2,
    ),
    { encoding: 'utf8', mode: 0o600 },
  );

  const registryKeys = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  ];
  for (const key of registryKeys) {
    await execFileAsync('reg.exe', ['ADD', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
      windowsHide: true,
    });
  }
  return { registered: true, extensionId: EXTENSION_ID, manifestPath };
}
