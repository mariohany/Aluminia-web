import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { parseEnv } from '../../config/env.schema';

// Used two ways:
//  1. By the TypeORM CLI (migration:generate/run/revert) — runs outside
//     Nest's DI, so env vars are loaded here directly rather than via
//     ConfigModule.
//  2. As the source of connection options for TypeOrmModule.forRoot in
//     database/control-plane/typeorm.module.ts, so the app and the CLI
//     can never drift apart on how they connect.
config();
const env = parseEnv(process.env);

export const controlPlaneDataSourceOptions = {
  type: 'postgres' as const,
  url: env.DATABASE_URL,
  entities: [`${__dirname}/entities/*.entity{.ts,.js}`],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  // Migrations only, always — see CLAUDE.md's engineering standards.
  synchronize: false,
};

export default new DataSource(controlPlaneDataSourceOptions);
