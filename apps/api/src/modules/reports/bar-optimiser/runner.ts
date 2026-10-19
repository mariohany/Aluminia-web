import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { OptimiserSettings } from '@repo/bar-optimiser/optimise';
import {
  optimiseProject,
  type ProgressStep,
  type ProjectOptimisation,
  type ProjectPiece,
} from '@repo/bar-optimiser/project';

export type ProgressEvent = { type: 'start' | 'done'; step: ProgressStep };

/** The error a solve stopped by the safety cap fails with
 * (docs/report_queue_planing.md C5); the job stores it as `job_error`. */
export const SOLVE_TIMEOUT_ERROR = 'timeout';

/**
 * Where a project's optimisation runs. From the compiled app (`dist/`)
 * it's a `worker_threads` worker, so a solve that takes minutes (D21: no
 * time cap) never blocks the event loop. Under ts-jest there is no `.js`
 * worker file to start, so it runs in-process: same function, same
 * progress events.
 *
 * A solve still running after `timeoutMs` rejects with
 * `SOLVE_TIMEOUT_ERROR`: the worker is terminated. In-process (tests
 * only) the promise rejects but the solve itself can't be stopped.
 */
@Injectable()
export class BarOptimiserRunner {
  run<T>(
    pieces: ProjectPiece<T>[],
    settings: OptimiserSettings,
    onProgress: (event: ProgressEvent) => void,
    timeoutMs: number,
  ): Promise<ProjectOptimisation<T>> {
    const workerFile = join(__dirname, 'optimiser.worker.js');
    if (!__filename.endsWith('.js') || !existsSync(workerFile)) {
      return withTimeout(
        optimiseProject(pieces, settings, {
          onProfileStart: (step) => onProgress({ type: 'start', step }),
          onProfileDone: (step) => onProgress({ type: 'done', step }),
        }),
        timeoutMs,
      );
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(workerFile, {
        workerData: { pieces, settings },
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(SOLVE_TIMEOUT_ERROR));
        void worker.terminate();
      }, timeoutMs);
      worker.on('message', (message: WorkerMessage<T>) => {
        if (message.type === 'start' || message.type === 'done') {
          onProgress(message);
        } else if (message.type === 'result') {
          settled = true;
          clearTimeout(timer);
          resolve(message.result);
          void worker.terminate();
        } else if (message.type === 'error') {
          settled = true;
          clearTimeout(timer);
          reject(new Error(message.message));
          void worker.terminate();
        }
      });
      worker.on('error', (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      worker.on('exit', (code) => {
        clearTimeout(timer);
        if (!settled) {
          reject(new Error(`Bar optimiser worker exited with code ${code}`));
        }
      });
    });
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(SOLVE_TIMEOUT_ERROR)), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

type WorkerMessage<T> =
  | ProgressEvent
  | { type: 'result'; result: ProjectOptimisation<T> }
  | { type: 'error'; message: string };
