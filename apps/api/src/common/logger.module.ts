import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import type { Env } from '../config/env.schema';

/**
 * What request logs must never carry: the access token (Authorization),
 * the refresh token (the cookie on the way in, Set-Cookie on the way out).
 * Anyone who can read the logs could otherwise sign in as that user.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
          genReqId: (req: IncomingMessage & { id?: string }) =>
            req.id ?? randomUUID(),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggerModule {}
