import { describe, expect, it } from 'vitest';
import { userPagePath } from './userPath';

describe('userPagePath', () => {
    it('ID があれば /@ID、無ければ内部 ID', () => {
        expect(userPagePath({ id: 'u1', handle: 'youkan' })).toBe('/@youkan');
        expect(userPagePath({ id: 'u 1', handle: null })).toBe('/user/u%201');
    });
});
