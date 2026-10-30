import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type { DynastySnapshot, TeamNeedsDynasty } from '../shared/types';
import { cleanMovements, HistoryStoreFile } from './history-store';
import { migrateLegacyPromoData } from './legacy-migration';
import { runWorker } from './run-worker';
import { resolveTeamBranding } from './team-branding';

// Portable builds keep their data beside the executable so the folder can move.
if (app.isPackaged) app.setPath('userData', path.join(path.dirname(process.execPath), 'data'));
if (started) app.quit();

app.setAppUserModelId('whoisrez.cfb27-utilities');

const history = new HistoryStoreFile(() => app.getPath('userData'));

// Promotion/Relegation and Team Needs share one active dynasty file, but each
// module has its own reader and Sync action. Importing chooses the file once;
// syncing a module never runs the other module's parser.
let currentSnapshot: DynastySnapshot | null = null;
let latestSnapshot: DynastySnapshot | null = null;

function lastSavePathFile(): string { return path.join(app.getPath('userData'), 'last-dynasty-save.txt'); }

async function rememberSave(filePath: string): Promise<void> {
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(lastSavePathFile(), filePath, 'utf8');
  } catch { /* optional */ }
}

async function readRememberedSave(): Promise<string | null> {
  try {
    const filePath = (await readFile(lastSavePathFile(), 'utf8')).trim();
    if (!filePath) return null;
    await access(filePath);
    return filePath;
  } catch { return null; }
}

async function activeSavePath(): Promise<string> {
  const filePath = latestSnapshot?.filePath ?? currentSnapshot?.filePath ?? await readRememberedSave();
  if (!filePath) throw new Error('No dynasty save has been loaded yet. Use Import Dynasty first.');
  await access(filePath);
  return filePath;
}

async function loadSave(filePath: string): Promise<DynastySnapshot> {
  await access(filePath);
  const incoming = await runWorker<DynastySnapshot>('save-reader-worker.js', 'Dynasty reader', filePath);
  latestSnapshot = incoming;
  await rememberSave(filePath);
  const dynasty = await history.registerImport(incoming);
  const season = dynasty.seasons.find((item) => item.seasonYear === incoming.seasonYear);
  // The season's locked review snapshot wins over a newer sync of the same year.
  currentSnapshot = season?.snapshot ?? incoming;
  return currentSnapshot;
}

async function chooseSave(): Promise<DynastySnapshot | null> {
  let filePath = process.env.CFB27_TEST_DYNASTY_SAVE || '';
  if (!filePath) {
    const remembered = await readRememberedSave();
    const defaultPath = remembered ? path.dirname(remembered) : path.join(app.getPath('documents'), 'EA SPORTS College Football 27', 'saves');
    const result = await dialog.showOpenDialog({ title: 'Select CFB 27 Dynasty Save', defaultPath, properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    filePath = result.filePaths[0];
  }
  return loadSave(filePath);
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'main_window', 'index.html'));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#050505',
    title: 'CFB 27 Utilities',
    icon: path.join(app.getAppPath(), 'assets', 'app-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });

  void loadRenderer(window).catch(async (error) => {
    await dialog.showMessageBox(window, {
      type: 'error',
      title: 'CFB 27 Utilities',
      message: 'The application interface could not be loaded.',
      detail: error instanceof Error ? error.message : String(error),
    });
  });
}

ipcMain.handle('team-needs:sync', async () =>
  runWorker<TeamNeedsDynasty>('team-needs-worker.js', 'Team Needs reader', await activeSavePath()));
ipcMain.handle('team-needs:team-branding', async (_event, teamName: unknown) => {
  const name = String(teamName ?? '').trim();
  return name ? resolveTeamBranding(name) : null;
});

ipcMain.handle('promo:choose-and-load', chooseSave);
ipcMain.handle('promo:sync-current-save', async () => loadSave(await activeSavePath()));
ipcMain.handle('promo:get-latest-snapshot', async () => latestSnapshot);
ipcMain.handle('promo:get-history', async (_event, dynastyId: unknown) => history.getDynasty(String(dynastyId ?? '')));
ipcMain.handle('promo:close-season', async (_event, dynastyId: unknown, seasonYear: unknown, movements: unknown) =>
  history.closeSeason(String(dynastyId ?? ''), Number(seasonYear), cleanMovements(movements)));
ipcMain.handle('promo:reopen-season', async (_event, dynastyId: unknown, seasonYear: unknown) => {
  const { dynasty, season } = await history.reopenSeason(String(dynastyId ?? ''), Number(seasonYear));
  currentSnapshot = season.snapshot;
  latestSnapshot = season.latestSnapshot ?? season.snapshot;
  return dynasty;
});

app.whenReady().then(async () => {
  // One-time merge of history from the older standalone apps (development runs only).
  try {
    if (await migrateLegacyPromoData()) console.log('Migrated legacy Promotion/Relegation history into CFB 27 Utilities.');
  } catch (error) {
    console.warn('Legacy Promotion/Relegation history migration failed:', error);
  }
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
