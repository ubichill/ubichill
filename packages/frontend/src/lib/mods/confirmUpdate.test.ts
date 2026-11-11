import { createModLock, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { selectionWithCheckedVersions } from '../../pages/world-editor/lib/modSelection';
import { confirmModUpdate } from './confirmUpdate';

const entry = (caps: string[]): ModLockEntry => ({
    id: 'demo',
    version: '1.0.0',
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: { 'demo:main': { workerUrl: 'main.js', integrity: `sha256-${'A'.repeat(43)}=`, capabilities: caps } },
});
it('署名の作者を自動的に依存へ付けず、本体・URL依存のlock v1互換性を保つ', () => {
    const result = selectionWithCheckedVersions(
        [
            { name: 'demo', source: { version: 'latest' } },
            { name: 'external', source: { version: 'latest', url: 'https://cdn.example' } },
        ],
        [
            { modId: 'demo', version: '1.0.0' },
            { modId: 'external', version: '2.0.0' },
        ],
    );
    expect(result.every((d) => !d.source.author)).toBe(true);
    expect(result.map((d) => d.source.version)).toEqual(['1.0.0', '2.0.0']);
});
it('利用者が指定した作者参照は版を選び直しても維持する', () => {
    expect(
        selectionWithCheckedVersions(
            [{ name: 'demo', source: { author: 'alice@example.com', version: '1.0.0', url: 'https://cdn.example' } }],
            [{ modId: 'demo', version: '2.0.0' }],
        )[0].source.author,
    ).toBe('alice@example.com');
});
describe('all editor installation routes', () => {
    it.each([false, true])('権限天井の拡大の結果は利用者の承認=%sに従う', async (answer) => {
        const confirm = vi.fn(async () => answer);
        expect(
            await confirmModUpdate(
                createModLock({ demo: entry(['ui:render']) }),
                createModLock({ demo: entry(['ui:render', 'network:fetch']) }),
                confirm,
            ),
        ).toBe(answer);
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('network:fetch'));
    });
    it('権限が増えなければ確認を繰り返さない', async () => {
        const confirm = vi.fn(async () => false);
        const lock = createModLock({ demo: entry(['ui:render']) });
        expect(await confirmModUpdate(lock, lock, confirm)).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
    });
});
