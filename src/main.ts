import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import started from 'electron-squirrel-startup';
import type { DynastyHistory, DynastySnapshot, HistoryStore, Movement, StoredSeason } from './types';
import type { TeamNeedsDynasty } from './team-needs-reader';
import { resolveTeamNeedsBranding } from './team-needs-branding-main';
import './conference-write-ipc';

if (app.isPackaged) app.setPath('userData', path.join(path.dirname(process.execPath), 'data'));
if (started) app.quit();

app.setAppUserModelId('whoisrez.cfb27-utilities');

type WorkerResponse<T> = { ok: true; data: T } | { ok: false; error: string };

// Promotion/Relegation and Team Needs share one active dynasty file, but each
// module has its own reader and Sync action. Importing chooses the file once;
// syncing a module never runs the other module's parser.
let currentSnapshot: DynastySnapshot | null = null;
let latestSnapshot: DynastySnapshot | null = null;
const pendingIndependentMoves = new Map<string, Movement[]>();

function storePath(): string { return path.join(app.getPath('userData'), 'promotion-relegation-history.json'); }
function lastSavePathFile(): string { return path.join(app.getPath('userData'), 'last-dynasty-save.txt'); }
function appIconPath(): string { return path.join(app.getAppPath(), 'assets', 'app-icon.ico'); }
function independentKey(dynastyId: string, seasonYear: number): string { return `${dynastyId}:${seasonYear}`; }
function seasonChampionCount(snapshot: DynastySnapshot): number {
  return snapshot.conferenceChampions.filter((champion) => champion.seasonYear === snapshot.seasonYear).length;
}
function isReviewReady(snapshot: DynastySnapshot): boolean {
  const phase = `${snapshot.currentStage} ${snapshot.currentWeekType}`.toLowerCase();
  return phase.includes('offseason') && seasonChampionCount(snapshot) >= 10;
}
function normalizeStoredSeason(season: StoredSeason): void {
  if (!season.latestSnapshot) season.latestSnapshot = season.snapshot;
  if (season.reviewLockedAt === undefined && (season.closed || isReviewReady(season.snapshot))) {
    season.reviewLockedAt = season.snapshot.importedAt;
  }
}

async function readStore(): Promise<HistoryStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf8')) as HistoryStore;
    if (parsed?.version === 1 && parsed.dynasties) {
      for (const dynasty of Object.values(parsed.dynasties)) {
        for (const season of dynasty.seasons) normalizeStoredSeason(season);
      }
      return parsed;
    }
  } catch { /* fresh store */ }
  return { version: 1, dynasties: {} };
}

async function writeStore(store: HistoryStore): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(storePath(), JSON.stringify(store, null, 2), 'utf8');
}

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

function runSaveWorker(filePath: string): Promise<DynastySnapshot> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'save-reader-worker.js'));
    let settled = false;
    const finish = () => { settled = true; void worker.terminate(); };
    worker.once('message', (response: WorkerResponse<DynastySnapshot>) => {
      finish();
      if ('data' in response) resolve(response.data); else reject(new Error(response.error));
    });
    worker.once('error', (error) => { finish(); reject(error); });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? 'Dynasty reader exited before returning data.' : `Dynasty reader exited with code ${code}.`));
    });
    worker.postMessage({ kind: 'load', filePath });
  });
}

function runTeamNeedsWorker(filePath: string): Promise<TeamNeedsDynasty> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'team-needs-worker.js'));
    let settled = false;
    const finish = () => { settled = true; void worker.terminate(); };
    worker.once('message', (response: WorkerResponse<TeamNeedsDynasty>) => {
      finish();
      if ('data' in response) resolve(response.data); else reject(new Error(response.error));
    });
    worker.once('error', (error) => { finish(); reject(error); });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? 'Team Needs reader exited before returning data.' : `Team Needs reader exited with code ${code}.`));
    });
    worker.postMessage({ kind: 'load', filePath });
  });
}

async function registerImport(snapshot: DynastySnapshot): Promise<DynastyHistory> {
  const store = await readStore();
  const existing = store.dynasties[snapshot.dynastyId];
  const dynasty: DynastyHistory = existing ?? {
    dynastyId: snapshot.dynastyId,
    label: path.basename(snapshot.filePath),
    savePath: snapshot.filePath,
    seasons: [],
  };
  dynasty.label = path.basename(snapshot.filePath);
  dynasty.savePath = snapshot.filePath;

  const season = dynasty.seasons.find((item) => item.seasonYear === snapshot.seasonYear);
  if (!season) {
    dynasty.seasons.push({
      seasonYear: snapshot.seasonYear,
      closed: false,
      closedAt: null,
      reopenedAt: null,
      snapshot,
      latestSnapshot: snapshot,
      reviewLockedAt: isReviewReady(snapshot) ? snapshot.importedAt : null,
      movements: [],
    });
  } else {
    normalizeStoredSeason(season);
    season.latestSnapshot = snapshot;
    const locked = season.closed || Boolean(season.reviewLockedAt);
    if (!locked) {
      season.snapshot = snapshot;
      if (isReviewReady(snapshot)) season.reviewLockedAt = snapshot.importedAt;
    }
  }

  dynasty.seasons.sort((a, b) => b.seasonYear - a.seasonYear);
  store.dynasties[snapshot.dynastyId] = dynasty;
  await writeStore(store);
  return dynasty;
}

async function loadSave(filePath: string): Promise<DynastySnapshot> {
  await access(filePath);
  const incoming = await runSaveWorker(filePath);
  latestSnapshot = incoming;
  await rememberSave(filePath);
  const dynasty = await registerImport(incoming);
  const season = dynasty.seasons.find((item) => item.seasonYear === incoming.seasonYear);
  currentSnapshot = season?.snapshot ?? incoming;
  return currentSnapshot;
}

async function chooseSave(): Promise<DynastySnapshot | null> {
  const testSave = process.env.CFB27_TEST_DYNASTY_SAVE;
  let filePath = testSave || '';
  if (!filePath) {
    const remembered = await readRememberedSave();
    const defaultPath = remembered ? path.dirname(remembered) : path.join(app.getPath('documents'), 'EA SPORTS College Football 27', 'saves');
    const result = await dialog.showOpenDialog({ title: 'Select CFB 27 Dynasty Save', defaultPath, properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    filePath = result.filePaths[0];
  }
  return loadSave(filePath);
}

async function syncCurrentSave(): Promise<DynastySnapshot> {
  const filePath = latestSnapshot?.filePath ?? currentSnapshot?.filePath ?? await readRememberedSave();
  if (!filePath) throw new Error('No dynasty save has been loaded yet. Use Import Dynasty first.');
  return loadSave(filePath);
}

async function syncTeamNeedsSave(): Promise<TeamNeedsDynasty> {
  const filePath = latestSnapshot?.filePath ?? currentSnapshot?.filePath ?? await readRememberedSave();
  if (!filePath) throw new Error('No dynasty save has been loaded yet. Use Import Dynasty first.');
  await access(filePath);
  return runTeamNeedsWorker(filePath);
}

async function loadRenderer(mainWindow: BrowserWindow): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }
  const rendererPath = path.join(__dirname, '..', 'renderer', 'main_window', 'index.html');
  await mainWindow.loadFile(rendererPath);
}

function createWindow(): void {
  const icon = appIconPath();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#050505',
    title: 'CFB 27 Utilities',
    icon,
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

ipcMain.handle('team-needs:sync', syncTeamNeedsSave);
ipcMain.handle('team-needs:team-branding', async (_event, teamName: unknown) => {
  const name = String(teamName ?? '').trim();
  return name ? resolveTeamNeedsBranding(name) : null;
});

ipcMain.handle('promo:choose-and-load', chooseSave);
ipcMain.handle('promo:sync-current-save', syncCurrentSave);
ipcMain.handle('promo:get-current-snapshot', async () => currentSnapshot);
ipcMain.handle('promo:get-latest-snapshot', async () => latestSnapshot);
ipcMain.handle('promo:get-history', async (_event, dynastyId: unknown) => {
  const store = await readStore();
  const id = String(dynastyId ?? '');
  return id ? store.dynasties[id] ?? null : store;
});
ipcMain.handle('promo:set-independent-movements', async (_event, dynastyId: unknown, seasonYear: unknown, movements: Movement[]) => {
  const id = String(dynastyId ?? '');
  const year = Number(seasonYear);
  const clean = Array.isArray(movements)
    ? movements.filter((movement) => movement.pairKey === 'independent' && (movement.kind === 'to-independent' || movement.kind === 'from-independent'))
    : [];
  pendingIndependentMoves.set(independentKey(id, year), clean);
  return clean;
});
ipcMain.handle('promo:close-season', async (_event, dynastyId: unknown, seasonYear: unknown, movements: Movement[]) => {
  const store = await readStore();
  const id = String(dynastyId ?? '');
  const year = Number(seasonYear);
  const dynasty = store.dynasties[id];
  if (!dynasty) throw new Error('Dynasty history was not found.');
  const season = dynasty.seasons.find((item) => item.seasonYear === year);
  if (!season) throw new Error('Season was not found.');
  normalizeStoredSeason(season);
  const baseMovements = Array.isArray(movements) ? movements.filter((movement) => movement.pairKey !== 'independent') : [];
  const key = independentKey(id, year);
  const existingIndependent = season.movements.filter((movement) => movement.pairKey === 'independent');
  const independentMovements = pendingIndependentMoves.has(key) ? pendingIndependentMoves.get(key)! : existingIndependent;
  season.movements = [...baseMovements, ...independentMovements];
  season.closed = true;
  season.closedAt = new Date().toISOString();
  season.reopenedAt = null;
  season.reviewLockedAt = season.reviewLockedAt ?? season.snapshot.importedAt;
  await writeStore(store);
  return dynasty;
});
ipcMain.handle('promo:reopen-season', async (_event, dynastyId: unknown, seasonYear: unknown) => {
  const store = await readStore();
  const dynasty = store.dynasties[String(dynastyId ?? '')];
  if (!dynasty) throw new Error('Dynasty history was not found.');
  const season = dynasty.seasons.find((item) => item.seasonYear === Number(seasonYear));
  if (!season) throw new Error('Season was not found.');
  normalizeStoredSeason(season);
  season.closed = false;
  season.reopenedAt = new Date().toISOString();
  currentSnapshot = season.snapshot;
  latestSnapshot = season.latestSnapshot ?? season.snapshot;
  pendingIndependentMoves.set(independentKey(dynasty.dynastyId, season.seasonYear), season.movements.filter((movement) => movement.pairKey === 'independent'));
  await writeStore(store);
  return dynasty;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
