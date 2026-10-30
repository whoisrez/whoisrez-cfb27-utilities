import { parentPort } from 'node:worker_threads';
import {
  loadDepthChart,
  verifyDepthChart,
  writeDepthChart,
  type DepthChartWriteRequest,
} from './depth-chart-save';

type Request =
  | { kind: 'load'; filePath: string; teamIndex?: number | null }
  | { kind: 'write'; inputPath: string; outputPath: string; request: DepthChartWriteRequest }
  | { kind: 'verify'; filePath: string; request: DepthChartWriteRequest };

if (!parentPort) throw new Error('Depth chart worker requires a parent port.');

parentPort.once('message', async (message: Request) => {
  try {
    if (message.kind === 'load') {
      parentPort!.postMessage({ ok: true, data: await loadDepthChart(message.filePath, message.teamIndex) });
      return;
    }
    if (message.kind === 'write') {
      parentPort!.postMessage({ ok: true, data: await writeDepthChart(message.inputPath, message.outputPath, message.request) });
      return;
    }
    if (message.kind === 'verify') {
      parentPort!.postMessage({ ok: true, data: { verifiedSlots: await verifyDepthChart(message.filePath, message.request) } });
      return;
    }
    throw new Error('Unsupported depth chart request.');
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
