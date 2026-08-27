import { parentPort } from 'node:worker_threads';
import { loadTeamNeedsDynasty } from './team-needs-reader';

if (!parentPort) throw new Error('Team Needs reader worker requires a parent port.');

type WorkerRequest = { kind: 'load'; filePath: string };

parentPort.once('message', async (request: WorkerRequest) => {
  try {
    const data = await loadTeamNeedsDynasty(request.filePath);
    parentPort?.postMessage({ ok: true, data });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
