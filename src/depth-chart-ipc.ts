import { app, dialog, ipcMain } from 'electron';
import { access, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { DepthChartLoad, DepthChartWriteRequest, DepthChartWriteResult } from './depth-chart-save';

type WorkerResponse<T> = { ok: true; data: T } | { ok: false; error: string };
type WorkerRequest =
  | { kind: 'load'; filePath: string; teamIndex?: number | null }
  | { kind: 'write'; inputPath: string; outputPath: string; request: DepthChartWriteRequest }
  | { kind: 'verify'; filePath: string; request: DepthChartWriteRequest };

export type DepthChartSaveResult = {
  outputPath: string;
  backupPath: string | null;
  writtenSlots: number;
  writtenEntries: number;
  verifiedSlots: number;
};

function runWorker<T>(request: WorkerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'depth-chart-worker.js'));
    let settled = false;
    const finish = () => { settled = true; void worker.terminate(); };
    worker.once('message', (response: WorkerResponse<T>) => {
      finish();
      if ('data' in response) resolve(response.data); else reject(new Error(response.error));
    });
    worker.once('error', (error) => { finish(); reject(error); });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? 'Depth chart worker exited before returning data.' : `Depth chart worker exited with code ${code}.`));
    });
    worker.postMessage(request);
  });
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function isFileLock(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '').toUpperCase();
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

/** First unused "<save>-DC-v<n>" name beside the original save, so no earlier copy is ever reused. */
async function nextVersionedPath(inputPath: string): Promise<string> {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext).replace(/-DC-v\d+$/i, '');
  for (let version = 1; version < 1000; version += 1) {
    const candidate = path.join(dir, `${base}-DC-v${version}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  return path.join(dir, `${base}-DC-${stamp()}${ext}`);
}

function cleanRequest(value: unknown): DepthChartWriteRequest {
  const raw = value as Partial<DepthChartWriteRequest> | null;
  const teamIndex = Number(raw?.teamIndex);
  if (!Number.isInteger(teamIndex) || teamIndex < 0) throw new Error('A valid team was not provided.');
  const slots = Array.isArray(raw?.slots) ? raw!.slots : [];
  return {
    teamIndex,
    slots: slots.map((slot) => ({
      key: String(slot?.key ?? '') as DepthChartWriteRequest['slots'][number]['key'],
      rows: Array.isArray(slot?.rows) ? slot.rows.map(Number).filter((row) => Number.isInteger(row) && row >= 0) : [],
    })),
  };
}

ipcMain.handle('depth-chart:load', async (_event, rawFilePath: unknown, rawTeamIndex: unknown) => {
  const filePath = path.resolve(String(rawFilePath ?? ''));
  if (!rawFilePath) throw new Error('No dynasty save has been loaded yet. Use Import Dynasty first.');
  await access(filePath);
  const teamIndex = rawTeamIndex == null || rawTeamIndex === '' ? null : Number(rawTeamIndex);
  return runWorker<DepthChartLoad>({ kind: 'load', filePath, teamIndex: Number.isFinite(teamIndex) ? teamIndex : null });
});

ipcMain.handle('depth-chart:write', async (_event, rawFilePath: unknown, rawRequest: unknown): Promise<DepthChartSaveResult | null> => {
  const inputPath = path.resolve(String(rawFilePath ?? ''));
  if (!rawFilePath) throw new Error('No dynasty save path was provided.');
  await access(inputPath);
  const request = cleanRequest(rawRequest);
  if (!request.slots.length) throw new Error('There is nothing to write.');

  const suggested = await nextVersionedPath(inputPath);
  const picked = await dialog.showSaveDialog({
    title: 'Save the new depth chart as a copy of your dynasty',
    defaultPath: suggested,
    buttonLabel: 'Save Copy',
  });
  if (picked.canceled || !picked.filePath) return null;
  const outputPath = path.resolve(picked.filePath);

  const tempDir = path.join(app.getPath('userData'), 'write-temp');
  const backupDir = path.join(app.getPath('userData'), 'backups');
  await Promise.all([mkdir(tempDir, { recursive: true }), mkdir(backupDir, { recursive: true })]);
  const tempPath = path.join(tempDir, `depth-chart.${stamp()}.tmp`);

  let backupPath: string | null = null;
  let targetReplaced = false;
  let stage = 'temporary save write';
  try {
    const write = await runWorker<DepthChartWriteResult>({ kind: 'write', inputPath, outputPath: tempPath, request });

    stage = 'temporary save verification';
    await runWorker<{ verifiedSlots: number }>({ kind: 'verify', filePath: tempPath, request });

    if (await exists(outputPath)) {
      stage = 'backup of the file being replaced';
      backupPath = path.join(backupDir, `${path.basename(outputPath)}.${stamp()}.bak`);
      await copyFile(outputPath, backupPath);
    }

    stage = 'copy to chosen file';
    try {
      await copyFile(tempPath, outputPath);
    } catch (copyError) {
      if (isFileLock(copyError)) {
        throw new Error(`That file is locked. Back out of the dynasty to the CFB 27 main menu and try again.\n\n${errorText(copyError)}`);
      }
      throw copyError;
    }
    targetReplaced = true;

    stage = 'final verification';
    const final = await runWorker<{ verifiedSlots: number }>({ kind: 'verify', filePath: outputPath, request });
    return { outputPath, backupPath, writtenSlots: write.writtenSlots, writtenEntries: write.writtenEntries, verifiedSlots: final.verifiedSlots };
  } catch (error) {
    if (targetReplaced) {
      if (backupPath) await copyFile(backupPath, outputPath).catch(() => {});
      else await rm(outputPath, { force: true }).catch(() => {});
    }
    const logPath = path.join(app.getPath('userData'), 'last-depth-chart-error.txt');
    await writeFile(logPath, [`Time: ${new Date().toISOString()}`, `Stage: ${stage}`, `Save: ${inputPath}`, `Output: ${outputPath}`, '', errorText(error), ''].join('\n'), 'utf8').catch(() => {});
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nStage: ${stage}\nError log: ${logPath}`);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
});
