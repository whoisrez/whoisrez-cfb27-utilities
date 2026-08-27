import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

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

async function copyIfMissing(source: string, destination: string): Promise<boolean> {
  if (await exists(destination)) return false;
  if (!(await exists(source))) return false;
  const data = await readFile(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
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

  let migrated = false;
  for (const legacyDir of legacyDirs) {
    const historyCopied = await copyIfMissing(
      path.join(legacyDir, HISTORY_FILE),
      path.join(currentDir, HISTORY_FILE),
    );
    const saveCopied = await copyIfMissing(
      path.join(legacyDir, LAST_SAVE_FILE),
      path.join(currentDir, LAST_SAVE_FILE),
    );
    migrated = historyCopied || saveCopied || migrated;
    if (historyCopied) break;
  }

  return migrated;
}
