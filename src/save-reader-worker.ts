import { parentPort } from 'node:worker_threads';
import { loadDynastySnapshot } from './dynasty-reader';

if (!parentPort) throw new Error('Dynasty reader worker requires a parent port.');
parentPort.on('message', async (request: { kind: 'load'; filePath: string }) => {
  try {
    if (request.kind !== 'load') throw new Error('Unsupported worker request.');
    const data = await loadDynastySnapshot(request.filePath);
    parentPort!.postMessage({ ok: true, data });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
