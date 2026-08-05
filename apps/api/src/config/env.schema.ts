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

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Separate secrets so a leaked access token can't be replayed as a
  // refresh token or vice versa.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
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
