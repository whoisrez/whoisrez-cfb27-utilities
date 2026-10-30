import { contextBridge, ipcRenderer } from 'electron';
import type { Movement, PromoApi, TeamNeedsApi } from './shared/types';

const teamNeedsAPI: TeamNeedsApi = {
  sync: () => ipcRenderer.invoke('team-needs:sync'),
  getTeamBranding: (teamName) => ipcRenderer.invoke('team-needs:team-branding', teamName),
};

const promoAPI: PromoApi = {
  chooseAndLoad: () => ipcRenderer.invoke('promo:choose-and-load'),
  syncCurrentSave: () => ipcRenderer.invoke('promo:sync-current-save'),
  getLatestSnapshot: () => ipcRenderer.invoke('promo:get-latest-snapshot'),
  getHistory: (dynastyId) => ipcRenderer.invoke('promo:get-history', dynastyId),
  closeSeason: (dynastyId, seasonYear, movements: Movement[]) => ipcRenderer.invoke('promo:close-season', dynastyId, seasonYear, movements),
  reopenSeason: (dynastyId, seasonYear) => ipcRenderer.invoke('promo:reopen-season', dynastyId, seasonYear),
};

contextBridge.exposeInMainWorld('teamNeedsAPI', teamNeedsAPI);
contextBridge.exposeInMainWorld('promoAPI', promoAPI);
