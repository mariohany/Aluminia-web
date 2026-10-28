/**
 * Where file bytes live (docs/company_profile_planing.md §3a). The rest of
 * the API never knows which driver is behind it: Postgres today
 * (`PostgresFileStorage`), DO Spaces / S3 later, picked by `FILE_STORAGE`.
 *
 * Keys are S3-shaped (`companies/<companyId>/<purpose>/<id>.<ext>`), so
 * moving to a bucket is a copy. A key never leaves the server; clients see
 * the file's id (`files` table) instead.
 */
export interface FileStorage {
  /** `contentType` is kept as object metadata by drivers that have it
   * (S3); the `files` row is where the API reads it from. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The bytes, or null when no file has that key. */
  get(key: string): Promise<Buffer | null>;
  /** No-op when the key is already gone. */
  delete(key: string): Promise<void>;
  /** Deletes every key that starts with `prefix`; returns how many. */
  deletePrefix(prefix: string): Promise<number>;
}

/** Nest injection token for the active driver. */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

// Lower-case path segments only, no `..`, no leading slash: keys become
// object names in a bucket, so they are validated at every use, the way
// schema names are.
const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,511}$/;

export function assertValidStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

/** A prefix is a key that ends in `/`. */
export function assertValidStoragePrefix(prefix: string): void {
  if (!prefix.endsWith('/')) {
    throw new Error(
      `Storage prefix must end in "/": ${JSON.stringify(prefix)}`,
    );
  }
  assertValidStorageKey(prefix);
}

/** Every file a company owns lives under this prefix. */
export function companyStoragePrefix(companyId: string): string {
  return `companies/${companyId.toLowerCase()}/`;
}

/** Where the platform's own files go (owner null: the billing logo). */
export function ownerStoragePrefix(companyId: string | null): string {
  return companyId === null ? 'platform/' : companyStoragePrefix(companyId);
}
