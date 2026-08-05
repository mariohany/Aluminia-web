import {
  assertValidSchemaName,
  deriveUniqueSchemaName,
  isValidSchemaName,
  toSchemaNameCandidate,
} from './schema-name';

describe('isValidSchemaName', () => {
  it('accepts names we generate', () => {
    expect(isValidSchemaName('tenant_acme_windows')).toBe(true);
    expect(isValidSchemaName('tenant_acme_2')).toBe(true);
  });

  it('rejects anything without the tenant_ prefix', () => {
    expect(isValidSchemaName('public')).toBe(false);
    expect(isValidSchemaName('acme')).toBe(false);
  });

  it('rejects SQL injection attempts', () => {
    expect(isValidSchemaName('tenant_a; DROP SCHEMA public CASCADE; --')).toBe(
      false,
    );
    expect(isValidSchemaName('tenant_a"')).toBe(false);
    expect(isValidSchemaName("tenant_a'")).toBe(false);
    expect(isValidSchemaName('tenant_a b')).toBe(false);
  });

  it('rejects uppercase, which Postgres would fold and we never generate', () => {
    expect(isValidSchemaName('tenant_Acme')).toBe(false);
  });

  it('rejects an over-long name that Postgres would silently truncate', () => {
    expect(isValidSchemaName(`tenant_${'a'.repeat(56)}`)).toBe(false);
  });
});

describe('assertValidSchemaName', () => {
  it('throws on an unsafe name rather than returning it', () => {
    expect(() =>
      assertValidSchemaName('tenant_a; DROP SCHEMA public; --'),
    ).toThrow(/unsafe schema name/);
  });

  it('passes a valid name through silently', () => {
    expect(() => assertValidSchemaName('tenant_acme')).not.toThrow();
  });
});

describe('toSchemaNameCandidate', () => {
  it('slugifies a normal company name', () => {
    expect(toSchemaNameCandidate('Acme Windows')).toBe('tenant_acme_windows');
  });

  it('collapses punctuation and trims separators', () => {
    expect(toSchemaNameCandidate('  Acme & Co. — Windows!  ')).toBe(
      'tenant_acme_co_windows',
    );
  });

  it('falls back when a name has no usable ASCII (e.g. Arabic)', () => {
    expect(toSchemaNameCandidate('شركة الألوميتال')).toBe('tenant_company');
  });

  it('always produces a name that passes validation', () => {
    for (const name of [
      'Acme Windows',
      'شركة الألوميتال',
      '!!!',
      'A'.repeat(200),
    ]) {
      expect(isValidSchemaName(toSchemaNameCandidate(name))).toBe(true);
    }
  });
});

describe('deriveUniqueSchemaName', () => {
  it('uses the plain candidate when it is free', async () => {
    const name = await deriveUniqueSchemaName('Acme Windows', () =>
      Promise.resolve(false),
    );
    expect(name).toBe('tenant_acme_windows');
  });

  it('appends a numeric suffix on collision', async () => {
    const taken = new Set(['tenant_acme', 'tenant_acme_2']);
    const name = await deriveUniqueSchemaName('Acme', (candidate) =>
      Promise.resolve(taken.has(candidate)),
    );
    expect(name).toBe('tenant_acme_3');
  });

  it('keeps two identically-named companies apart', async () => {
    const taken = new Set<string>();
    const isTaken = (candidate: string) =>
      Promise.resolve(taken.has(candidate));

    const first = await deriveUniqueSchemaName('Acme', isTaken);
    taken.add(first);
    const second = await deriveUniqueSchemaName('Acme', isTaken);

    expect(first).not.toBe(second);
  });
});
