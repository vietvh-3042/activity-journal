import { app, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import type {
  AnnotateSegmentsRequest,
  CollectorStatus,
  DeleteRequest,
  SearchRequest,
  Settings,
  TimelineRequest,
  WeeklyStatsRequest,
} from '../shared/contracts.js';
import type { HelperClient } from './helper-client.js';
import { registerNativeMessagingHost } from './native-messaging.js';

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request payload');
}

export function registerIpc(helper: HelperClient): void {
  ipcMain.handle('journal:status', () => helper.request<CollectorStatus>('status'));
  ipcMain.handle('journal:search', (_event, request: SearchRequest) => {
    assertObject(request);
    return helper.request('search', request);
  });
  ipcMain.handle('journal:timeline', (_event, request: TimelineRequest) => {
    assertObject(request);
    return helper.request('timeline', request);
  });
  ipcMain.handle('journal:weeklyStats', (_event, request: WeeklyStatsRequest) => {
    assertObject(request);
    return helper.request('weeklyStats', request);
  });
  ipcMain.handle('journal:getSettings', () => helper.request<Settings>('getSettings'));
  ipcMain.handle('journal:updateSettings', (_event, settings: Settings) => {
    assertObject(settings);
    return helper.request<Settings>('updateSettings', settings);
  });
  ipcMain.handle('journal:annotateSegments', (_event, request: AnnotateSegmentsRequest) => {
    assertObject(request);
    if (
      !Array.isArray(request.ids) ||
      request.ids.length < 1 ||
      request.ids.length > 500 ||
      request.ids.some((id) => !Number.isInteger(id) || id < 1)
    )
      throw new Error('Invalid segment IDs');
    return helper.request<{ updated: number }>('annotateSegments', request);
  });
  ipcMain.handle('journal:pause', (_event, minutes?: number) => {
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60)) {
      throw new Error('Invalid pause duration');
    }
    return helper.request<CollectorStatus>('pause', { minutes });
  });
  ipcMain.handle('journal:resume', () => helper.request<CollectorStatus>('resume'));
  ipcMain.handle('journal:delete', async (_event, request: DeleteRequest) => {
    assertObject(request);
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Xóa dữ liệu hoạt động',
      message: request.all ? 'Xóa toàn bộ lịch sử?' : 'Xóa lịch sử trong khoảng thời gian đã chọn?',
      detail: 'Hành động này không thể hoàn tác.',
      buttons: ['Hủy', 'Xóa'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return { deleted: 0 };
    return helper.request<{ deleted: number }>('delete', request);
  });
  ipcMain.handle('journal:setAutoStart', (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid auto-start value');
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('journal:openExtensionFolder', () => {
    const path = app.isPackaged
      ? join(process.resourcesPath, 'extension')
      : join(app.getAppPath(), 'extension');
    return shell.openPath(path).then((error) => {
      if (error) throw new Error(error);
    });
  });
  ipcMain.handle('journal:repairBrowserIntegration', () => registerNativeMessagingHost());
}
