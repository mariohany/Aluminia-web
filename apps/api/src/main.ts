import { NestFactory } from '@nestjs/core';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
    app
      .get(Logger)
      .fatal(
        `Database is behind this build — refusing to start. Pending migrations:\n  ${describePending(pending)}\n` +
          `Apply them with: npm run migrate:deploy --workspace=apps/api`,
      );
    await app.close();
    process.exit(1);
  }

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
