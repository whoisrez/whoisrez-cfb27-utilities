import path from 'node:path';
import { Worker } from 'node:worker_threads';

type WorkerResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Run one of the bundled save-reader workers (built next to main.js) for a
 * single request and resolve with its data. Save parsing happens off the main
 * thread so the window stays responsive while a large dynasty file is read.
 */
export function runWorker<T>(workerFile: string, label: string, filePath: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, workerFile));
    let settled = false;
    const finish = () => { settled = true; void worker.terminate(); };
    worker.once('message', (response: WorkerResponse<T>) => {
      finish();
      if (response.ok) resolve(response.data); else reject(new Error(response.error));
    });
    worker.once('error', (error) => { finish(); reject(error); });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? `${label} exited before returning data.` : `${label} exited with code ${code}.`));
    });
    worker.postMessage({ kind: 'load', filePath });
  });
}
