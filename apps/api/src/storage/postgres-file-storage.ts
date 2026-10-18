import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  assertValidStorageKey,
  assertValidStoragePrefix,
  type FileStorage,
} from './file-storage';

/**
 * FileStorage on the control-plane database: one `stored_blobs` row per
 * key. Works everywhere Postgres does (local, CI, Render), which is why it
 * comes first; DO Spaces is a later driver (§3a). The content type lives
 * on the `files` row, so this driver ignores `put`'s `contentType`.
 */
@Injectable()
export class PostgresFileStorage implements FileStorage {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async put(key: string, body: Buffer): Promise<void> {
    assertValidStorageKey(key);
    await this.dataSource.query(
      `INSERT INTO stored_blobs (key, body) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body`,
      [key, body],
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidStorageKey(key);
    const rows: Array<{ body: Buffer }> = await this.dataSource.query(
      `SELECT body FROM stored_blobs WHERE key = $1`,
      [key],
    );
    return rows[0]?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await this.dataSource.query(`DELETE FROM stored_blobs WHERE key = $1`, [
      key,
    ]);
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertValidStoragePrefix(prefix);
    // starts_with, not LIKE: `_` is a LIKE wildcard and keys contain it.
    const result: [unknown[], number] = await this.dataSource.query(
      `DELETE FROM stored_blobs WHERE starts_with(key, $1)`,
      [prefix],
    );
    return result[1];
  }
}
