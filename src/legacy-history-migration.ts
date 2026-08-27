import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { HistoryStore, StoredSeason } from './types';

const HISTORY_FILE = 'promotion-relegation-history.json';
const LAST_SAVE_FILE = 'last-dynasty-save.txt';

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readHistory(filePath: string): Promise<HistoryStore | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as HistoryStore;
    return parsed?.version === 1 && parsed.dynasties ? parsed : null;
  } catch {
    return null;
  }
}

function shouldPreferLegacy(legacy: StoredSeason, current: StoredSeason): boolean {
  const legacyMoves = Array.isArray(legacy.movements) ? legacy.movements.length : 0;
  const currentMoves = Array.isArray(current.movements) ? current.movements.length : 0;

  if (legacy.closed && !current.closed) return true;
  if (legacyMoves > currentMoves) return true;
  if (legacyMoves > 0 && currentMoves === 0) return true;
  return false;
}

function mergeStore(current: HistoryStore, legacy: HistoryStore): boolean {
  let changed = false;

  for (const [dynastyId, legacyDynasty] of Object.entries(legacy.dynasties)) {
    const currentDynasty = current.dynasties[dynastyId];
    if (!currentDynasty) {
      current.dynasties[dynastyId] = legacyDynasty;
      changed = true;
      continue;
    }

    for (const legacySeason of legacyDynasty.seasons) {
      const index = currentDynasty.seasons.findIndex((season) => season.seasonYear === legacySeason.seasonYear);
      if (index < 0) {
        currentDynasty.seasons.push(legacySeason);
        changed = true;
        continue;
      }

      if (shouldPreferLegacy(legacySeason, currentDynasty.seasons[index])) {
        currentDynasty.seasons[index] = legacySeason;
        changed = true;
      }
    }

    currentDynasty.seasons.sort((a, b) => b.seasonYear - a.seasonYear);
  }

  return changed;
}

async function copyLastSaveIfMissing(legacyDir: string, currentDir: string): Promise<boolean> {
  const destination = path.join(currentDir, LAST_SAVE_FILE);
  if (await exists(destination)) return false;
  const source = path.join(legacyDir, LAST_SAVE_FILE);
  if (!(await exists(source))) return false;
  await mkdir(currentDir, { recursive: true });
  await writeFile(destination, await readFile(source));
  return true;
}

export async function migrateLegacyPromoData(): Promise<boolean> {
  if (app.isPackaged) return false;

  const currentDir = app.getPath('userData');
  const appData = app.getPath('appData');
  const legacyDirs = [
    path.join(appData, 'cfb27-promotion-relegation'),
    path.join(appData, 'CFB 27 Promotion Relegation Tracker'),
    path.join(appData, 'CFB 27 Dynasty Tools'),
  ].filter((dir) => path.resolve(dir) !== path.resolve(currentDir));

  const currentPath = path.join(currentDir, HISTORY_FILE);
  const current = (await readHistory(currentPath)) ?? { version: 1 as const, dynasties: {} };
  let changed = false;

  for (const legacyDir of legacyDirs) {
    const legacy = await readHistory(path.join(legacyDir, HISTORY_FILE));
    if (legacy) changed = mergeStore(current, legacy) || changed;
    changed = (await copyLastSaveIfMissing(legacyDir, currentDir)) || changed;
  }

  if (changed) {
    await mkdir(currentDir, { recursive: true });
    await writeFile(currentPath, JSON.stringify(current, null, 2), 'utf8');
  }

  return changed;
}
