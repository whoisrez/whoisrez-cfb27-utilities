import { parentPort } from 'node:worker_threads';
import type { DepthChartWriteRequest } from '../../shared/depth-chart';
import { loadDepthChart, verifyDepthChart, writeDepthChart } from '../depth-chart/save';

export type DepthChartWorkerRequest =
  | { kind: 'load'; filePath: string; teamIndex?: number | null }
  | { kind: 'write'; inputPath: string; outputPath: string; request: DepthChartWriteRequest }
  | { kind: 'verify'; filePath: string; request: DepthChartWriteRequest };

if (!parentPort) throw new Error('Depth chart worker requires a parent port.');

parentPort.once('message', async (message: DepthChartWorkerRequest) => {
  try {
    let data: unknown;
    if (message.kind === 'load') data = await loadDepthChart(message.filePath, message.teamIndex);
    else if (message.kind === 'write') data = await writeDepthChart(message.inputPath, message.outputPath, message.request);
    else if (message.kind === 'verify') data = { verifiedSlots: await verifyDepthChart(message.filePath, message.request) };
    else throw new Error('Unsupported depth chart request.');
    parentPort?.postMessage({ ok: true, data });
  } catch (error) {
    parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
