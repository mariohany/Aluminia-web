import { BadRequestException, ConflictException } from '@nestjs/common';

// Postgres foreign_key_violation. Every lookup table's references use
// ON DELETE RESTRICT (see the migration), so Postgres itself refuses a
// delete that would orphan a reference — this turns that raw driver
// error into the same readable message across every entity instead of
// leaking "update or delete on table X violates constraint..." to the
// client. The same code also fires on create/update when a given
// brandId/catalogId/glassId doesn't exist, so callers pass a message
// that fits the operation.
export function translatePostgresError(error: unknown, message: string): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23503'
  ) {
    throw new BadRequestException(message);
  }
  throw error as Error;
}

// Postgres unique_violation — none of the platform lookup tables trip
// this today (nothing pre-checks a duplicate colour code before
// inserting), but the company lookup tables' case-insensitive unique
// indexes (docs/company_lookups_planing.md's company-vs-company identity
// rule) do, on every create/update/bulk-duplicate. Kept alongside
// translatePostgresError rather than duplicated in company-lookups/
// since both translate the same driver error shape into a readable
// exception, just to a different HTTP status.
export function translateUniqueViolation(
  error: unknown,
  message: string,
): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  ) {
    throw new ConflictException(message);
  }
  throw error as Error;
}
