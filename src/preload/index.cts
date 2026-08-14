import { contextBridge, ipcRenderer } from 'electron';
import type { ActivityJournalApi, CollectorStatus } from '../shared/contracts.js';

const api: ActivityJournalApi = {
  getStatus: () => ipcRenderer.invoke('journal:status'),
  search: (request) => ipcRenderer.invoke('journal:search', request),
  getTimeline: (request) => ipcRenderer.invoke('journal:timeline', request),
  getWeeklyStats: (request) => ipcRenderer.invoke('journal:weeklyStats', request),
  getSettings: () => ipcRenderer.invoke('journal:getSettings'),
  updateSettings: (settings) => ipcRenderer.invoke('journal:updateSettings', settings),
  annotateSegments: (request) => ipcRenderer.invoke('journal:annotateSegments', request),
  pause: (minutes) => ipcRenderer.invoke('journal:pause', minutes),
  resume: () => ipcRenderer.invoke('journal:resume'),
  deleteData: (request) => ipcRenderer.invoke('journal:delete', request),
  setAutoStart: (enabled) => ipcRenderer.invoke('journal:setAutoStart', enabled),
  openExtensionFolder: () => ipcRenderer.invoke('journal:openExtensionFolder'),
  repairBrowserIntegration: () => ipcRenderer.invoke('journal:repairBrowserIntegration'),
  onStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: CollectorStatus) => callback(status);
    ipcRenderer.on('journal:statusChanged', listener);
    return () => ipcRenderer.removeListener('journal:statusChanged', listener);
  },
};

contextBridge.exposeInMainWorld('activityJournal', api);
