import { app, dialog, ipcMain } from 'electron';
import { access, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Movement } from './types';

type WorkerResponse<T> = { ok: true; data: T } | { ok: false; error: string };
type WriterRequest =
  | { kind: 'write'; inputPath: string; outputPath: string; movements: Movement[] }
  | { kind: 'validate'; filePath: string; movements: Movement[] }
  | { kind: 'diff'; beforePath: string; afterPath: string; outputPath: string };

type WriteResult = { appliedMovements: number; skippedIndependent: number };
type ValidateResult = { verifiedMovements: number };
type DiffResult = { outputPath: string; changedTables: number; changedFields: number };

function cleanMovements(value: unknown): Movement[] {
  if (!Array.isArray(value)) return [];
  return value.filter((movement): movement is Movement => {
    if (!movement || typeof movement !== 'object') return false;
    const item = movement as Partial<Movement>;
    return Number.isFinite(Number(item.teamIndex)) && typeof item.pairKey === 'string' && typeof item.kind === 'string';
  });
}

function runWriter<T>(request: WriterRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'conference-writer-worker.js'));
    let settled = false;
    const finish = () => { settled = true; void worker.terminate(); };
    worker.once('message', (response: WorkerResponse<T>) => {
      finish();
      if ('data' in response) resolve(response.data); else reject(new Error(response.error));
    });
    worker.once('error', (error) => { finish(); reject(error); });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? 'Conference writer exited before returning data.' : `Conference writer exited with code ${code}.`));
    });
    worker.postMessage(request);
  });
}

function safeBaseName(filePath: string): string {
  return path.basename(filePath).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function isLikelyFileLock(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '').toUpperCase();
  const message = errorText(error).toUpperCase();
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || message.includes('EBUSY') || message.includes('EPERM') || message.includes('EACCES');
}

async function persistWriteError(stage: string, filePath: string, error: unknown): Promise<string> {
  const logPath = path.join(app.getPath('userData'), 'last-write-error.txt');
  const body = [
    `Time: ${new Date().toISOString()}`,
    `Stage: ${stage}`,
    `Save: ${filePath}`,
    '',
    errorText(error),
    '',
  ].join('\n');
  await writeFile(logPath, body, 'utf8').catch(() => {});
  return logPath;
}

ipcMain.handle('promo:probe-conference-diff', async (_event, rawCurrentPath: unknown) => {
  const currentPath = path.resolve(String(rawCurrentPath ?? ''));
  const defaultPath = currentPath ? path.dirname(currentPath) : undefined;

  const beforePick = await dialog.showOpenDialog({
    title: 'Select BEFORE save — before the manual conference move',
    defaultPath,
    properties: ['openFile'],
  });
  if (beforePick.canceled || !beforePick.filePaths[0]) return null;

  const afterPick = await dialog.showOpenDialog({
    title: 'Select AFTER save — after the manual conference move',
    defaultPath,
    properties: ['openFile'],
  });
  if (afterPick.canceled || !afterPick.filePaths[0]) return null;

  const outputPath = path.join(app.getPath('userData'), 'conference-diff.json');
  return runWriter<DiffResult>({
    kind: 'diff',
    beforePath: beforePick.filePaths[0],
    afterPath: afterPick.filePaths[0],
    outputPath,
  });
});

ipcMain.handle('promo:apply-conference-changes', async (_event, rawFilePath: unknown, rawMovements: unknown) => {
  const filePath = path.resolve(String(rawFilePath ?? ''));
  const movements = cleanMovements(rawMovements);
  const paired = movements.filter((movement) => movement.pairKey !== 'independent' && (movement.kind === 'promotion' || movement.kind === 'relegation'));
  const skippedIndependent = movements.filter((movement) => movement.pairKey === 'independent').length;
  if (!filePath) throw new Error('No dynasty save path was provided.');
  if (!paired.length) throw new Error('No paired promotion/relegation movements are ready to apply.');
  await access(filePath);

  const backupDir = path.join(app.getPath('userData'), 'backups');
  const tempDir = path.join(app.getPath('userData'), 'write-temp');
  await Promise.all([mkdir(backupDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);

  const base = safeBaseName(filePath);
  const stamp = timestamp();
  const backupPath = path.join(backupDir, `${base}.${stamp}.bak`);
  const tempPath = path.join(tempDir, `${base}.${stamp}.tmp`);

  let stage = 'backup';
  let originalOverwritten = false;

  try {
    await copyFile(filePath, backupPath);

    stage = 'temporary save write';
    const write = await runWriter<WriteResult>({ kind: 'write', inputPath: filePath, outputPath: tempPath, movements });

    stage = 'temporary save verification';
    const tempValidation = await runWriter<ValidateResult>({ kind: 'validate', filePath: tempPath, movements });
    if (tempValidation.verifiedMovements !== write.appliedMovements) {
      throw new Error(`Temporary-save verification count mismatch (${tempValidation.verifiedMovements}/${write.appliedMovements}).`);
    }

    stage = 'original save overwrite';
    try {
      await copyFile(tempPath, filePath);
    } catch (overwriteError) {
      if (isLikelyFileLock(overwriteError)) {
        throw new Error(`The dynasty save is currently locked. Back out of the dynasty to the CFB 27 main menu and try again. You only need to close the whole game if the save remains locked from the main menu.\n\n${errorText(overwriteError)}`);
      }
      throw overwriteError;
    }
    originalOverwritten = true;

    stage = 'final save verification';
    try {
      const finalValidation = await runWriter<ValidateResult>({ kind: 'validate', filePath, movements });
      if (finalValidation.verifiedMovements !== write.appliedMovements) {
        throw new Error(`Final verification count mismatch (${finalValidation.verifiedMovements}/${write.appliedMovements}).`);
      }
      await rm(path.join(app.getPath('userData'), 'last-write-error.txt'), { force: true }).catch(() => {});
      return {
        backupPath,
        appliedMovements: write.appliedMovements,
        verifiedMovements: finalValidation.verifiedMovements,
        skippedIndependent: Math.max(skippedIndependent, write.skippedIndependent),
      };
    } catch (verificationError) {
      stage = 'final verification / backup restore';
      await copyFile(backupPath, filePath);
      originalOverwritten = false;
      throw new Error(`Final save verification failed and the backup was restored. ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`);
    }
  } catch (error) {
    if (originalOverwritten) {
      stage = 'unexpected overwrite-stage failure / backup restore';
      try { await copyFile(backupPath, filePath); } catch { /* best effort after an unexpected overwrite-stage error */ }
    }
    const logPath = await persistWriteError(stage, filePath, error);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nStage: ${stage}\nError log: ${logPath}`);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
});
