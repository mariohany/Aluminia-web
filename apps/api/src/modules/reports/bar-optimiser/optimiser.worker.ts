import { parentPort, workerData } from 'node:worker_threads';
import type { OptimiserSettings } from '@repo/bar-optimiser/optimise';
import {
  optimiseProject,
  type ProjectPiece,
} from '@repo/bar-optimiser/project';

// Runs one project's optimisation off the API's event loop
// (docs/reports_planing.md §7, D22): a long solve must never stall other
// requests. Started by BarOptimiserRunner from the compiled `dist/`.
// Messages: `start` / `done` per profile, then `result` or `error`.

const { pieces, settings } = workerData as {
  pieces: ProjectPiece<unknown>[];
  settings: OptimiserSettings;
};

optimiseProject(pieces, settings, {
  onProfileStart: (step) => parentPort?.postMessage({ type: 'start', step }),
  onProfileDone: (step) => parentPort?.postMessage({ type: 'done', step }),
})
  .then((result) => parentPort?.postMessage({ type: 'result', result }))
  .catch((error: unknown) =>
    parentPort?.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
