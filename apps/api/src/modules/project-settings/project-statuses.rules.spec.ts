import { isSameIdSet, visibleResponsible } from './project-statuses.rules';

describe('project status rules', () => {
  describe('visibleResponsible', () => {
    const active = new Map([
      ['u1', 'hana@test.local'],
      ['u2', 'youssef@test.local'],
    ]);

    it('keeps active users in the stored order', () => {
      expect(visibleResponsible(['u2', 'u1'], active)).toEqual([
        { id: 'u2', email: 'youssef@test.local' },
        { id: 'u1', email: 'hana@test.local' },
      ]);
    });

    it('drops ids that are no longer active users of the company', () => {
      expect(visibleResponsible(['gone', 'u1'], active)).toEqual([
        { id: 'u1', email: 'hana@test.local' },
      ]);
      expect(visibleResponsible(['gone'], active)).toEqual([]);
    });
  });

  describe('isSameIdSet', () => {
    it('accepts the same ids in any order', () => {
      expect(isSameIdSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    });

    it('refuses a missing, extra, unknown or repeated id', () => {
      expect(isSameIdSet(['a', 'b'], ['a'])).toBe(false);
      expect(isSameIdSet(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
      expect(isSameIdSet(['a', 'b'], ['a', 'x'])).toBe(false);
      expect(isSameIdSet(['a', 'b'], ['a', 'a'])).toBe(false);
    });
  });
});
