import { contextBridge, ipcRenderer } from 'electron';
import type { Movement } from './types';

contextBridge.exposeInMainWorld('teamNeedsAPI', {
  sync: () => ipcRenderer.invoke('team-needs:sync'),
  getTeamBranding: (teamName: string) => ipcRenderer.invoke('team-needs:team-branding', teamName),
});

contextBridge.exposeInMainWorld('promoAPI', {
  chooseAndLoad: () => ipcRenderer.invoke('promo:choose-and-load'),
  syncCurrentSave: () => ipcRenderer.invoke('promo:sync-current-save'),
  getCurrentSnapshot: () => ipcRenderer.invoke('promo:get-current-snapshot'),
  getLatestSnapshot: () => ipcRenderer.invoke('promo:get-latest-snapshot'),
  getHistory: (dynastyId: string) => ipcRenderer.invoke('promo:get-history', dynastyId),
  setIndependentMovements: (dynastyId: string, seasonYear: number, movements: Movement[]) => ipcRenderer.invoke('promo:set-independent-movements', dynastyId, seasonYear, movements),
  closeSeason: (dynastyId: string, seasonYear: number, movements: Movement[]) => ipcRenderer.invoke('promo:close-season', dynastyId, seasonYear, movements),
  reopenSeason: (dynastyId: string, seasonYear: number) => ipcRenderer.invoke('promo:reopen-season', dynastyId, seasonYear),
  applyConferenceChanges: (filePath: string, movements: Movement[]) => ipcRenderer.invoke('promo:apply-conference-changes', filePath, movements),
  probeConferenceDiff: (currentFilePath: string) => ipcRenderer.invoke('promo:probe-conference-diff', currentFilePath),
});
