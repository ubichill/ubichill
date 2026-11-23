import { describe, expect, it } from 'vitest';
import { quotaChoices } from './storageQuota';

const MB = 1024 * 1024;

describe('quotaChoices', () => {
    it('50 MB から 10 GB までを小さい順に並べる', () => {
        expect(quotaChoices(200 * MB).map((c) => c.label)).toEqual([
            '50 MB',
            '100 MB',
            '200 MB',
            '500 MB',
            '1 GB',
            '2 GB',
            '5 GB',
            '10 GB',
        ]);
        expect(quotaChoices(200 * MB)[2]).toEqual({ value: String(200 * MB), label: '200 MB' });
    });

    it('選択肢に無い値（API で決めた）も、その位置に出す', () => {
        expect(
            quotaChoices(10 * MB)
                .map((c) => c.label)
                .slice(0, 2),
        ).toEqual(['10 MB', '50 MB']);
        expect(quotaChoices(1536 * MB).map((c) => c.label)).toContain('1.5 GB');
        expect(quotaChoices(1536 * MB)).toHaveLength(9);
    });
});
