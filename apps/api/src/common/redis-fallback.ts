import { Logger } from '@nestjs/common';

const logger = new Logger('RedisFallback');
const LOG_EVERY_MS = 60_000;
const lastLogged = new Map<string, number>();

/**
 * Logs that a Redis call failed and the caller fell back (stability S9),
 * at most once a minute per caller. While Redis is down every request
 * takes a fallback, and one line per request would bury the log.
 */
export function logRedisFallback(
  context: string,
  error: unknown,
  fallback: string,
): void {
  const now = Date.now();
  if (now - (lastLogged.get(context) ?? 0) < LOG_EVERY_MS) return;
  lastLogged.set(context, now);
  logger.warn(
    { err: error, context },
    `Redis failed in ${context}; ${fallback}`,
  );
}
