import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mods/modCdn', () => ({ MOD_CDN_URL: '/mods' }));

const { fetchRegistry } = await import('./useAvailableMods');

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const entry = { id: 'pen', version: '1.0.0', components: ['pen:pen'] };

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('fetchRegistry: 取れなかった一覧を覚えない', () => {
    it('通信の失敗は空を返し、次の呼び出しで取り直す', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('network'))
            .mockResolvedValueOnce(ok([entry]));
        vi.stubGlobal('fetch', fetchMock);
        const url = 'https://a.example/index.json';
        expect(await fetchRegistry(url, url)).toEqual([]);
        expect((await fetchRegistry(url, url)).map((m) => m.id)).toEqual(['pen']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('5xx も同じく取り直す', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockResolvedValueOnce(ok([entry]));
        vi.stubGlobal('fetch', fetchMock);
        const url = 'https://b.example/index.json';
        expect(await fetchRegistry(url, url)).toEqual([]);
        expect(await fetchRegistry(url, url)).toHaveLength(1);
    });

    it('配列でない JSON（壊れた index.json）も空にし、直れば取り直す', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(ok({ mods: [] }))
            .mockResolvedValueOnce(ok([entry]));
        vi.stubGlobal('fetch', fetchMock);
        const url = 'https://c.example/index.json';
        expect(await fetchRegistry(url, url)).toEqual([]);
        expect(await fetchRegistry(url, url)).toHaveLength(1);
    });

    it('取れた一覧は覚えておき、同時の呼び出しも 1 回の取得にまとめる', async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok([entry]));
        vi.stubGlobal('fetch', fetchMock);
        const url = 'https://d.example/index.json';
        const [a, b] = await Promise.all([fetchRegistry(url, url), fetchRegistry(url, url)]);
        await fetchRegistry(url, url);
        expect(a).toBe(b);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('空の一覧（mod が 0 件）は取れた結果として覚える', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => ok([]));
        vi.stubGlobal('fetch', fetchMock);
        const url = 'https://e.example/index.json';
        await fetchRegistry(url, url);
        await fetchRegistry(url, url);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
