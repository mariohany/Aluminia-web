import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { FILE_STORAGE } from './file-storage';
import { PostgresFileStorage } from './postgres-file-storage';

/**
 * Provides the FileStorage driver `FILE_STORAGE` names, globally. Only
 * `postgres` exists today; the S3 driver (DO Spaces) joins here and in
 * env.schema.ts's enum together, so an unknown value fails at boot.
 */
@Global()
@Module({
  providers: [
    PostgresFileStorage,
    {
      provide: FILE_STORAGE,
      inject: [ConfigService, PostgresFileStorage],
      useFactory: (
        config: ConfigService<Env, true>,
        postgres: PostgresFileStorage,
      ) => {
        const driver = config.get('FILE_STORAGE', { infer: true });
        new Logger('StorageModule').log(`File storage: ${driver}`);
        return postgres;
      },
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
