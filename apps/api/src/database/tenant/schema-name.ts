// Postgres identifiers max out at 63 bytes. Reserve room for the prefix
// and a numeric collision suffix.
const PREFIX = 'tenant_';
const MAX_SCHEMA_NAME_LENGTH = 63;
const MAX_SLUG_LENGTH = MAX_SCHEMA_NAME_LENGTH - PREFIX.length - 4;

/**
 * The single gate every schema name must pass before it reaches SQL.
 *
 * Schema names are interpolated into DDL (`CREATE SCHEMA`, `SET
 * search_path`) where bind parameters aren't allowed, so this pattern is
 * the actual injection defence — not a formatting nicety. Deliberately
 * strict: lowercase ASCII, digits, and underscores only, starting with
 * the fixed prefix.
 */
export const SCHEMA_NAME_PATTERN = /^tenant_[a-z0-9_]{1,55}$/;

export function isValidSchemaName(name: string): boolean {
  return SCHEMA_NAME_PATTERN.test(name);
}

/**
 * Throws unless `name` is a schema name we generated ourselves. Call this
 * immediately before any DDL that interpolates a schema name, even when
 * the value came from our own database — a corrupted or hand-edited
 * `companies.schema_name` row should fail loudly, not execute.
 */
export function assertValidSchemaName(name: string): void {
  if (!isValidSchemaName(name)) {
    throw new Error(
      `Refusing to use unsafe schema name: ${JSON.stringify(name)}`,
    );
  }
}

/**
 * Turns a company's display name into a schema-name candidate. Never
 * trusted on its own — the result still goes through
 * `assertValidSchemaName` before use, and callers must resolve
 * collisions (see `deriveUniqueSchemaName`).
 *
 * Arabic (and any other non-ASCII) company names transliterate to
 * nothing here, which is fine and expected: the fallback keeps the name
 * valid, and a schema name is an internal identifier no user ever sees.
 */
export function toSchemaNameCandidate(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  return `${PREFIX}${slug || 'company'}`;
}

/**
 * Finds a free schema name, appending `_2`, `_3`, … on collision.
 * `isTaken` is injected so this stays a pure function that's trivial to
 * test without a database.
 */
export async function deriveUniqueSchemaName(
  companyName: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = toSchemaNameCandidate(companyName);

  if (!(await isTaken(base))) {
    assertValidSchemaName(base);
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}_${suffix}`;
    if (!(await isTaken(candidate))) {
      assertValidSchemaName(candidate);
      return candidate;
    }
  }

  throw new Error(
    `Could not derive a unique schema name for ${JSON.stringify(companyName)}`,
  );
}
