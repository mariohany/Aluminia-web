import {
  assertValidStorageKey,
  assertValidStoragePrefix,
  companyStoragePrefix,
} from './file-storage';

describe('storage keys', () => {
  it('accepts the S3-shaped keys the API makes', () => {
    expect(() =>
      assertValidStorageKey(
        'companies/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/logo/9b2e.png',
      ),
    ).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['leading slash', '/companies/a/logo/x.png'],
    ['parent segment', 'companies/a/../b/x.png'],
    ['double slash', 'companies//x.png'],
    ['upper case', 'Companies/a/x.png'],
    ['space', 'companies/a b/x.png'],
    ['quote', "companies/a'/x.png"],
    ['too long', `companies/${'a'.repeat(520)}`],
  ])('refuses a key with %s', (_, key) => {
    expect(() => assertValidStorageKey(key)).toThrow('Invalid storage key');
  });

  it('wants a prefix to end in a slash', () => {
    expect(() => assertValidStoragePrefix('companies/a')).toThrow(
      'must end in',
    );
    expect(() => assertValidStoragePrefix('companies/a/')).not.toThrow();
  });

  it('builds a valid prefix per company', () => {
    const prefix = companyStoragePrefix('1B9D6BCD-BBFD-4B2D-9B5D-AB8DFBBD4BED');
    expect(prefix).toBe('companies/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/');
    expect(() => assertValidStoragePrefix(prefix)).not.toThrow();
  });
});
