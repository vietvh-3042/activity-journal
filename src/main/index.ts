import { app, BrowserWindow, Menu, Tray } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CollectorStatus, Settings } from '../shared/contracts.js';
import { HelperClient } from './helper-client.js';
import { registerIpc } from './ipc.js';
import { registerNativeMessagingHost } from './native-messaging.js';
import { createTrayIcon } from './tray-icon.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const helper = new HelperClient();
let dashboard: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let currentStatus: CollectorStatus | undefined;

if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  app.setPath('userData', join(process.env.LOCALAPPDATA, 'Activity Journal'));
}

if (!app.requestSingleInstanceLock()) app.quit();

function rendererUrl(): string {
  return process.env.VITE_DEV_SERVER_URL || new URL('../../dist/index.html', import.meta.url).toString();
}

function createDashboard(): BrowserWindow {
  if (dashboard && !dashboard.isDestroyed()) return dashboard;
  dashboard = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: join(currentDirectory, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  dashboard.removeMenu();
  void dashboard.loadURL(rendererUrl());
  dashboard.once('ready-to-show', () => dashboard?.show());
  dashboard.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      dashboard?.hide();
    }
  });
  dashboard.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dashboard.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl()) event.preventDefault();
  });
  return dashboard;
}

function showDashboard(): void {
  const window = createDashboard();
  window.show();
  window.focus();
}

async function refreshStatus(): Promise<void> {
  try {
    currentStatus = await helper.request<CollectorStatus>('status');
    dashboard?.webContents.send('journal:statusChanged', currentStatus);
  } catch {
    currentStatus = undefined;
  }
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const paused = currentStatus?.paused ?? false;
  tray.setToolTip(paused ? 'Activity Journal — đang tạm dừng' : 'Activity Journal — đang ghi');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở Activity Journal', click: showDashboard },
      { type: 'separator' },
      {
        label: paused ? 'Tiếp tục ghi' : 'Tạm dừng 15 phút',
        click: () =>
          void helper
            .request(paused ? 'resume' : 'pause', paused ? undefined : { minutes: 15 })
            .then(refreshStatus),
      },
      {
        label: 'Tạm dừng 1 giờ',
        enabled: !paused,
        click: () => void helper.request('pause', { minutes: 60 }).then(refreshStatus),
      },
      {
        label: 'Tạm dừng đến khi tiếp tục',
        enabled: !paused,
        click: () => void helper.request('pause', {}).then(refreshStatus),
      },
      { type: 'separator' },
      {
        label: 'Thoát và ngừng ghi',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

app.on('second-instance', showDashboard);
app.on('before-quit', () => {
  quitting = true;
  helper.stop();
});

void app.whenReady().then(async () => {
  app.setAppUserModelId('com.activityjournal.desktop');
  helper.start();
  registerIpc(helper);
  tray = new Tray(createTrayIcon());
  tray.on('double-click', showDashboard);
  rebuildTrayMenu();

  try {
    await registerNativeMessagingHost();
  } catch (error) {
    console.error('Could not register browser native messaging host', error);
  }
  try {
    await helper.waitUntilReady();
    const settings = await helper.request<Settings>('getSettings');
    app.setLoginItemSettings({ openAtLogin: settings.autoStart, args: ['--hidden'] });
  } catch (error) {
    console.error(error);
  }
  await refreshStatus();
  setInterval(() => void refreshStatus(), 30_000).unref();

  if (!process.argv.includes('--hidden')) showDashboard();
});
