import { describe, expect, it, vi } from 'vitest';
import { checkModInstallation } from './modInstallation';
import type { ModAuthorCheck } from './modSignature';

const dependency = { name: 'video-player', source: { version: 'latest', url: 'https://mods.test' } };
const deps = (result: ModAuthorCheck) => ({
    baseUrl: '/mods',
    resolveLatest: vi.fn(async () => '3.1.0'),
    checkAuthor: vi.fn(async () => result),
    allowUnsigned: vi.fn(() => false),
});

describe('mod のインストール前確認', () => {
    it('latest を取得元から解決して、その版の作者を確かめる', async () => {
        const d = deps({ status: 'verified', author: 'alice@example.com' });
        expect(await checkModInstallation([dependency], d)).toMatchObject([{ version: '3.1.0', allowed: true }]);
        expect(d.resolveLatest).toHaveBeenCalledWith('https://mods.test', 'video-player');
        expect(d.checkAuthor).toHaveBeenCalledWith('https://mods.test', 'video-player', '3.1.0');
    });
    it('固定版は latest を解決せず、その版を確認する', async () => {
        const d = deps({ status: 'verified', author: 'alice@example.com' });
        await checkModInstallation([{ ...dependency, source: { version: '2.0.0' } }], d);
        expect(d.resolveLatest).not.toHaveBeenCalled();
        expect(d.checkAuthor).toHaveBeenCalledWith('/mods', 'video-player', '2.0.0');
    });
    it.each<ModAuthorCheck>([
        { status: 'unsigned' },
        { status: 'unavailable' },
        { status: 'rejected', reason: 'signature-invalid' },
    ])('利用できない版は反映しない: %j', async (result) => {
        expect(await checkModInstallation([dependency], deps(result))).toMatchObject([{ allowed: false }]);
    });
    it('開発用に許した取得元の未署名 mod は利用できる', async () => {
        const d = { ...deps({ status: 'unsigned' }), allowUnsigned: (base: string) => base === 'https://mods.test' };
        expect(await checkModInstallation([dependency], d)).toMatchObject([{ allowed: true }]);
    });
    it('開発用でも不正な署名を許さない', async () => {
        const d = { ...deps({ status: 'rejected', reason: 'signature-invalid' }), allowUnsigned: () => true };
        expect(await checkModInstallation([dependency], d)).toMatchObject([{ allowed: false }]);
    });
    it('取得不能・例外では確認失敗を返し、拒否する', async () => {
        const d = { ...deps({ status: 'data-only' }), resolveLatest: async () => null };
        expect(await checkModInstallation([dependency], d)).toMatchObject([
            { result: { status: 'unavailable' }, allowed: false },
        ]);
        const failing = {
            ...d,
            resolveLatest: async (): Promise<string> => {
                throw Error('offline');
            },
        };
        expect(await checkModInstallation([dependency], failing)).toMatchObject([{ allowed: false }]);
    });
    it('実行コードのない mod と、全 mod の削除は反映できる', async () => {
        expect(await checkModInstallation([dependency], deps({ status: 'data-only' }))).toMatchObject([
            { allowed: true },
        ]);
        expect(await checkModInstallation([], deps({ status: 'unsigned' }))).toEqual([]);
    });
});
