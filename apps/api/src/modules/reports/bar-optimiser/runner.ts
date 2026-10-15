import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { OptimiserSettings } from './optimise';
import {
  optimiseProject,
  type ProgressStep,
  type ProjectOptimisation,
  type ProjectPiece,
} from './project';

export type ProgressEvent = { type: 'start' | 'done'; step: ProgressStep };

/**
 * Where a project's optimisation runs. From the compiled app (`dist/`)
 * it's a `worker_threads` worker, so a solve that takes minutes (D21: no
 * time cap) never blocks the event loop. Under ts-jest there is no `.js`
 * worker file to start, so it runs in-process: same function, same
 * progress events.
 */
@Injectable()
export class BarOptimiserRunner {
  run<T>(
    pieces: ProjectPiece<T>[],
    settings: OptimiserSettings,
    onProgress: (event: ProgressEvent) => void,
  ): Promise<ProjectOptimisation<T>> {
    const workerFile = join(__dirname, 'optimiser.worker.js');
    if (!__filename.endsWith('.js') || !existsSync(workerFile)) {
      return optimiseProject(pieces, settings, {
        onProfileStart: (step) => onProgress({ type: 'start', step }),
        onProfileDone: (step) => onProgress({ type: 'done', step }),
      });
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(workerFile, {
        workerData: { pieces, settings },
      });
      let settled = false;
      worker.on('message', (message: WorkerMessage<T>) => {
        if (message.type === 'start' || message.type === 'done') {
          onProgress(message);
        } else if (message.type === 'result') {
          settled = true;
          resolve(message.result);
          void worker.terminate();
        } else if (message.type === 'error') {
          settled = true;
          reject(new Error(message.message));
          void worker.terminate();
        }
      });
      worker.on('error', (error: unknown) => {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      worker.on('exit', (code) => {
        if (!settled) {
          reject(new Error(`Bar optimiser worker exited with code ${code}`));
        }
      });
    });
  }
}

type WorkerMessage<T> =
  | ProgressEvent
  | { type: 'result'; result: ProjectOptimisation<T> }
  | { type: 'error'; message: string };
