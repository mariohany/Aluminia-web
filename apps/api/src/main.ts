// First: Sentry must load before Nest and Express to hook them.
import './instrument';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';
import {
  describePending,
  findPendingMigrations,
  hasPending,
} from './database/migration-check';
import { reportFatal } from './common/monitoring';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Refuse to serve a single request against a database this build has
  // out-run: an unapplied migration would otherwise surface as a 500 on
  // every route that touches the new column, far from its cause. Both
  // tracks, control plane and every tenant schema — see
  // database/migration-check.ts.
  const pending = await findPendingMigrations(
    app.get<DataSource>(getDataSourceToken()),
  );
  if (hasPending(pending)) {
    const message =
      `Database is behind this build — refusing to start. Pending migrations:\n  ${describePending(pending)}\n` +
      `Apply them with: npm run migrate:deploy --workspace=apps/api`;
    app.get(Logger).fatal(message);
    await reportFatal(message);
    await app.close();
    process.exit(1);
  }

  // See TRUST_PROXY in config/env.schema.ts.
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy === 'true' ? true : trustProxy);
  }

  // A browser-made bar optimiser result lists every piece of a project
  // (docs/browser_solve_planing.md §5): a big building can pass Express's
  // 100 KB default. Authenticated and throttled like every other body.
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }),
    credentials: true,
  });
  // ZodValidationPipe is registered as an APP_PIPE in AppModule, not
  // here — see that file's comment for why (e2e tests build the Nest
  // app straight from AppModule and never run this function).

  await app.listen(config.get('PORT', { infer: true }));
}
void bootstrap();
