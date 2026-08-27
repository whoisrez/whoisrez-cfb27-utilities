import { parentPort } from 'node:worker_threads';
import { compareConferenceSaves } from './conference-diff';
import { validateConferenceMovements, writeConferenceMovements } from './conference-writer';
import type { Movement } from './types';

type Request =
  | { kind: 'write'; inputPath: string; outputPath: string; movements: Movement[] }
  | { kind: 'validate'; filePath: string; movements: Movement[] }
  | { kind: 'diff'; beforePath: string; afterPath: string; outputPath: string };

if (!parentPort) throw new Error('Conference writer worker requires a parent port.');

parentPort.on('message', async (request: Request) => {
  try {
    if (request.kind === 'write') {
      const data = await writeConferenceMovements(request.inputPath, request.outputPath, request.movements);
      parentPort!.postMessage({ ok: true, data });
      return;
    }
    if (request.kind === 'validate') {
      const verifiedMovements = await validateConferenceMovements(request.filePath, request.movements);
      parentPort!.postMessage({ ok: true, data: { verifiedMovements } });
      return;
    }
    if (request.kind === 'diff') {
      const data = await compareConferenceSaves(request.beforePath, request.afterPath, request.outputPath);
      parentPort!.postMessage({ ok: true, data });
      return;
    }
    throw new Error('Unsupported conference writer request.');
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
