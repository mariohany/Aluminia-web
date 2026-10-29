import {
  isProfileComplete,
  missingProfileFields,
} from '@repo/types/company-profile';

// docs/subscriptions_planing.md B23: what must be filled before anything prints.
describe('missingProfileFields', () => {
  const complete = {
    enName: 'Nile Aluminium',
    arName: 'نايل للألوميتال',
    taxId: '123-456-789',
    commercialRegister: 'CR 1',
    phone: null,
    email: 'office@nile.test',
  };

  it('accepts a complete profile with a phone or an email', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(
      isProfileComplete({ ...complete, email: null, phone: '+20 100' }),
    ).toBe(true);
  });

  it('lists every missing field in form order', () => {
    expect(
      missingProfileFields({
        enName: 'Nile',
        arName: null,
        taxId: ' ',
        commercialRegister: null,
        phone: null,
        email: null,
      }),
    ).toEqual(['arName', 'taxId', 'commercialRegister', 'phoneOrEmail']);
  });
});
