import { describe, expect, it } from 'vitest';
import { keyFingerprint } from './keyFingerprint';

describe('keyFingerprint', () => {
    it('先頭と末尾を出して見比べやすくする', () => {
        expect(keyFingerprint('abcdef1234567890ghijklmnopqrstuvwxyzABCDEFG')).toBe('abcdef…BCDEFG');
    });
});
