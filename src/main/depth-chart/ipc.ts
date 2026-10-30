// Depth Chart IPC: read the active save, and write a chosen depth chart to a new
// versioned copy (the original save is only replaced if the user picks it in the
// save dialog, and then it is backed up first).
import { app, dialog, ipcMain } from 'electron';
import { access, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DepthChartLoad, DepthChartSaveResult, DepthChartWriteRequest } from '../../shared/depth-chart';
import { runWorkerRequest } from '../run-worker';
import type { DepthChartWorkerRequest } from '../workers/depth-chart-worker';
import type { DepthChartWriteResult } from './save';

const WORKER = 'depth-chart-worker.js';
const run = <T>(message: DepthChartWorkerRequest) => runWorkerRequest<T>(WORKER, 'Depth chart worker', message);

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const errorText = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error));

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

/** First unused "<save>-DC-v<n>" beside the original, so an earlier copy is never reused. */
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
      key: String(slot?.key ?? ''),
      rows: Array.isArray(slot?.rows) ? slot.rows.map(Number).filter((row) => Number.isInteger(row) && row >= 0) : [],
    })),
  };
}

export function registerDepthChartIpc(activeSavePath: () => Promise<string>): void {
  ipcMain.handle('depth-chart:load', async (_event, rawTeamIndex: unknown) => {
    const teamIndex = rawTeamIndex == null || rawTeamIndex === '' ? null : Number(rawTeamIndex);
    return run<DepthChartLoad>({ kind: 'load', filePath: await activeSavePath(), teamIndex: Number.isFinite(teamIndex) ? teamIndex : null });
  });

  ipcMain.handle('depth-chart:write', async (_event, rawFilePath: unknown, rawRequest: unknown): Promise<DepthChartSaveResult | null> => {
    if (!rawFilePath) throw new Error('No dynasty save path was provided.');
    const inputPath = path.resolve(String(rawFilePath));
    await access(inputPath);
    const request = cleanRequest(rawRequest);
    if (!request.slots.length) throw new Error('There is nothing to write.');

    const picked = await dialog.showSaveDialog({
      title: 'Save the new depth chart as a copy of your dynasty',
      defaultPath: await nextVersionedPath(inputPath),
      buttonLabel: 'Save Copy',
    });
    if (picked.canceled || !picked.filePath) return null;
    const outputPath = path.resolve(picked.filePath);

    const tempDir = path.join(app.getPath('userData'), 'write-temp');
    const backupDir = path.join(app.getPath('userData'), 'backups');
    await Promise.all([mkdir(tempDir, { recursive: true }), mkdir(backupDir, { recursive: true })]);
    const tempPath = path.join(tempDir, `depth-chart.${stamp()}.tmp`);

    let backupPath: string | null = null;
    let replaced = false;
    let stage = 'temporary save write';
    try {
      const write = await run<DepthChartWriteResult>({ kind: 'write', inputPath, outputPath: tempPath, request });
      stage = 'temporary save verification';
      await run({ kind: 'verify', filePath: tempPath, request });

      if (await exists(outputPath)) {
        stage = 'backup of the file being replaced';
        backupPath = path.join(backupDir, `${path.basename(outputPath)}.${stamp()}.bak`);
        await copyFile(outputPath, backupPath);
      }

      stage = 'copy to chosen file';
      try {
        await copyFile(tempPath, outputPath);
      } catch (error) {
        const code = String((error as { code?: unknown } | null)?.code ?? '').toUpperCase();
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
          throw new Error(`That file is locked. Back out of the dynasty to the CFB 27 main menu and try again.\n\n${errorText(error)}`);
        }
        throw error;
      }
      replaced = true;

      stage = 'final verification';
      const final = await run<{ verifiedSlots: number }>({ kind: 'verify', filePath: outputPath, request });
      return { outputPath, backupPath, writtenSlots: write.writtenSlots, writtenEntries: write.writtenEntries, verifiedSlots: final.verifiedSlots };
    } catch (error) {
      if (replaced) {
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
}
