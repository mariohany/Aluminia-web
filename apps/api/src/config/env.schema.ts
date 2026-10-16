import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Shared control-plane database (users, companies, billing). Tenant
  // schemas live on the same instance but are resolved per-request —
  // see modules/tenancy, added in Phase 5/6.
  DATABASE_URL: z.url(),

  REDIS_URL: z.url(),

  // Origin of apps/web, for CORS. A single origin, not a list — this
  // product is single-domain per CLAUDE.md, not multi-tenant-subdomain.
  CORS_ORIGIN: z.url(),

  // Express `trust proxy`, for when a reverse proxy sits in front of the
  // API. Unset (local) = req.ip is the socket address. Without it behind
  // a proxy every user shares the proxy's IP, so the per-IP throttle and
  // failed-login limit would lock everyone out together. "true" takes the
  // leftmost X-Forwarded-For entry — right only when the outermost proxy
  // overwrites that header, as Vercel's /api rewrite does; a number trusts
  // that many hops from the right.
  TRUST_PROXY: z
    .union([z.literal('true'), z.coerce.number().int().min(0)])
    .optional(),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Signs the access token only. The refresh token isn't a JWT: it's 32
  // random bytes, stored hashed in `sessions` — revocable one by one and
  // rotated on every use, with nothing to sign (stability S17).
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  // Sliding, not absolute: every refresh pushes it out again, so a user
  // who opens the app at all within a month never sees the login screen.
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // The Chrome the bar optimiser report prints its PDF with
  // (docs/reports_planing.md §8). Optional: Puppeteer finds the Chrome it
  // downloaded (`npx puppeteer browsers install chrome-headless-shell`) by itself; set
  // this only to use another binary.
  PUPPETEER_EXECUTABLE_PATH: z.string().min(1).optional(),

  // Report jobs run at once on this instance; more wait in line
  // (docs/report_queue_planing.md C1). Unset = CPU count - 1, at least 1.
  // Set it where the container may report the host's CPUs (Render: 1).
  REPORT_MAX_CONCURRENT: z.coerce.number().int().positive().optional(),
  // A solve still running after this many minutes is stopped and the job
  // fails with `timeout` (C5).
  REPORT_SOLVE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
