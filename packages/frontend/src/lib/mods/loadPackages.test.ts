import { createModLock, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { loadEditorPackages } from './loadPackages';

const entry = (id: string): ModLockEntry => ({
    id,
    version: '1.0.0',
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
});
describe('editor packages', () => {
    it('一部の取得・署名検証が失敗してもほかのpackageを返す', async () => {
        const lock = createModLock({ good: entry('good'), bad: entry('bad') });
        const result = await loadEditorPackages(lock, ['missing'], async (item) => {
            if (item.id === 'bad') throw new Error('署名不一致');
            return item.id;
        });
        expect(result.packages).toEqual(['good']);
        expect(result.failures).toEqual(['missing', 'bad: 署名不一致']);
    });
});
