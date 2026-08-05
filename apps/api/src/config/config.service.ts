import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

// `ConfigService<Env, true>` gives typed, required-by-default `.get()`
// calls everywhere it's injected — no need to redeclare this generic at
// every injection site.
export type AppConfigService = ConfigService<Env, true>;
