import { describe, expect, it } from 'vitest';
import { generationAction, generationLockUrl } from './devSession';

describe('generationAction', () => {
    it('最初の世代は使い始め、同じ世代は何もせず、違う世代なら読み直す', () => {
        const g1 = { buildId: 'r-1', instanceId: 'dev-r-1' };
        expect(generationAction(null, g1)).toBe('adopt');
        expect(generationAction(g1, { ...g1 })).toBe('keep');
        expect(generationAction(g1, { buildId: 'r-2', instanceId: 'dev-r-1' })).toBe('reload');
    });
    it('lock の URL は世代ごと', () => {
        expect(generationLockUrl('r-1')).toBe('/__ubichill/g/r-1/lock.json');
    });
});
