import type { ModLockEntry } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    devHost: true,
    verify: vi.fn(),
}));

vi.mock('./modCdn', () => ({
    MOD_CDN_URL: '/mods',
    HOST_MOD_SOURCE: {
        baseUrl: '/mods',
        get devHost() {
            return h.devHost;
        },
    },
}));
vi.mock('@/world/modSignature', async () => ({
    ...(await vi.importActual<typeof import('../../world/modSignature')>('../../world/modSignature')),
    browserSignatureVerifier: () => h.verify,
}));
vi.mock('@ubichill/loader', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@ubichill/loader')>()),
    readPackageManifest: async () => ({ id: 'pen' }),
}));

const { editorPackage } = await import('./packages');

const ORIGIN = 'http://localhost:5173';
const entry = (over: Partial<ModLockEntry> = {}): ModLockEntry => ({
    id: 'pen',
    version: '1.0.0',
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
    ...over,
});

/** 署名のファイルを返すサーバー。 */
const signatureServer = (status: number, body: unknown = null) =>
    vi.fn(async (url: string) => {
        expect(url).toMatch(/\/pen\/v1\.0\.0\/lock\.sig\.json$/);
        return new Response(status === 204 || status === 404 ? null : JSON.stringify(body), { status });
    });

beforeEach(() => {
    h.devHost = true;
    h.verify.mockReset();
    vi.stubGlobal('window', { location: { origin: ORIGIN } });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('editorPackage: 署名の無い mod を許すのは、開発用の Host が自分のオリジンから配るときだけ', () => {
    it('署名が 404・開発用の Host・同じオリジン・作者なしなら、確認せずに使う', async () => {
        vi.stubGlobal('fetch', signatureServer(404));
        await expect(editorPackage(entry())).resolves.toMatchObject({ entry: { id: 'pen' } });
        expect(h.verify).not.toHaveBeenCalled();
    });

    it('204 も署名なしとして同じに扱う', async () => {
        vi.stubGlobal('fetch', signatureServer(204));
        await expect(editorPackage(entry({ baseUrl: `${ORIGIN}/mods` }))).resolves.toBeDefined();
        expect(h.verify).not.toHaveBeenCalled();
    });

    it('本番の Host では、404 でも作者を確かめ、確かめられなければ使わない', async () => {
        h.devHost = false;
        vi.stubGlobal('fetch', signatureServer(404));
        h.verify.mockResolvedValue({ status: 'rejected', reason: 'missing' });
        await expect(editorPackage(entry())).rejects.toThrow('作者を確認できません');
        expect(h.verify).toHaveBeenCalledWith(expect.objectContaining({ id: 'pen' }), undefined);
    });

    it.each([
        ['別のオリジン', 'https://cdn.example/mods'],
        ['オリジンの前方一致', `${ORIGIN}.evil.example/mods`],
        ['userinfo に見せかけたオリジン', `http://localhost:5173@evil.example/mods`],
        ['ポート違い', 'http://localhost:5174/mods'],
    ])('開発用の Host でも、%s から配る mod は作者を確かめる', async (_, baseUrl) => {
        vi.stubGlobal('fetch', signatureServer(404));
        h.verify.mockResolvedValue({ status: 'rejected', reason: 'missing' });
        await expect(editorPackage(entry({ baseUrl }))).rejects.toThrow('作者を確認できません');
        expect(h.verify).toHaveBeenCalledTimes(1);
    });

    it('作者を指定した mod は、開発用の Host・同じオリジンでも作者を確かめる', async () => {
        vi.stubGlobal('fetch', signatureServer(404));
        h.verify.mockResolvedValue({ status: 'rejected', reason: 'missing' });
        await expect(editorPackage(entry({ author: 'alice@example.com' }))).rejects.toThrow('作者を確認できません');
    });

    it('署名があれば、その内容で作者を確かめて使う', async () => {
        const signature = { format: 'ubichill-signature', version: 2 };
        vi.stubGlobal('fetch', signatureServer(200, signature));
        h.verify.mockResolvedValue({ status: 'verified' });
        await expect(editorPackage(entry())).resolves.toBeDefined();
        expect(h.verify).toHaveBeenCalledWith(expect.objectContaining({ id: 'pen' }), signature);
    });

    it('署名の取得が 5xx なら、署名なしとして許さずに作者を確かめる', async () => {
        vi.stubGlobal('fetch', signatureServer(503));
        h.verify.mockResolvedValue({ status: 'rejected', reason: 'missing' });
        await expect(editorPackage(entry())).rejects.toThrow('作者を確認できません');
        expect(h.verify).toHaveBeenCalledWith(expect.anything(), undefined);
    });
});
