import * as Sentry from '@sentry/nestjs';
import { scrubEvent } from './common/monitoring';

// Sentry (docs/sentry_planing.md §6). The first import of main.ts: it must
// load before Nest and Express so it can hook them. Reads process.env
// directly because it runs before ConfigModule; env.schema.ts validates
// the same variables at boot. No SENTRY_DSN (laptops, CI, e2e) = off.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT,
    // Render sets RENDER_GIT_COMMIT on every deploy.
    release: process.env.SENTRY_RELEASE ?? process.env.RENDER_GIT_COMMIT,
    // Collect nothing about the request or the code's values (§8): Sentry
    // 11's defaults would send bodies, headers, cookies, query strings, DB
    // query values and every stack frame's local variables. The user id is
    // set by hand (monitoring.ts). scrubEvent removes them again.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    // Errors only, no tracing (Q6).
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}
