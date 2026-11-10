import { describe, expect, it } from 'vitest';
import { userPagePath } from './userPath';

describe('userPagePath', () => {
    it('/@ID', () => {
        expect(userPagePath({ handle: 'youkan' })).toBe('/@youkan');
    });
});
