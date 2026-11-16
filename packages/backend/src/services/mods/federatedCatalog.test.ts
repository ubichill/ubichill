import type { PackageDescriptor } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import {
    createFederatedModCatalog,
    FEDERATED_MOD_LIMIT,
    matchesModQuery,
    mergePeerMods,
    PEER_MOD_PAGES,
    PEER_MOD_TTL_MS,
    parseCatalogPage,
} from './federatedCatalog';

const mod = (author: string, id: string, version = '1.0.0'): PackageDescriptor => ({
    author,
    id,
    version,
    baseUrl: `https://${author.split('@')[1]}/mods`,
});
const SELF = 'ubichill.com';

describe('parseCatalogPage', () => {
    it('読める項目だけを残し、壊れた項目（http の取得先・不正な ID）は捨てる', () => {
        const ok = mod('bob@peer.example', 'pen');
        const page = parseCatalogPage({
            items: [ok, { ...ok, baseUrl: 'http://peer.example/mods' }, { ...ok, id: 'Bad_ID' }, 'pen', null],
            nextOffset: 20,
        });
        expect(page).toEqual({ items: [ok], nextOffset: 20 });
    });

    it('応答の形が違えば空。次のページは正の整数のときだけ', () => {
        for (const body of [null, 'x', [], { items: 'x' }]) expect(parseCatalogPage(body).items).toEqual([]);
        for (const nextOffset of [0, -20, 1.5, '20', null, Number.MAX_VALUE])
            expect(parseCatalogPage({ items: [], nextOffset }).nextOffset).toBeNull();
    });
});

describe('matchesModQuery', () => {
    const pen = mod('Bob@peer.example', 'pen');
    it('ID・作者・作者参照の部分一致で、大文字小文字を区別しない', () => {
        expect(matchesModQuery(pen, 'PEN')).toBe(true);
        expect(matchesModQuery(pen, 'bob@')).toBe(true);
        expect(matchesModQuery(pen, 'peer.example/pen')).toBe(true);
        expect(matchesModQuery(pen, '@bob@peer.example/pen')).toBe(true);
        expect(matchesModQuery(pen, 'brush')).toBe(false);
    });

    it('空白だけの検索語はすべてに一致する', () => {
        expect(matchesModQuery(pen, '   ')).toBe(true);
    });
});

describe('mergePeerMods', () => {
    it('このサーバーの作者は除く（ローカルに出ている）。ドメインの大文字小文字は区別しない', () => {
        const own = mod('youkan@UBICHILL.com', 'pen');
        const other = mod('bob@peer.example', 'pen');
        expect(mergePeerMods([[own, other]], SELF)).toEqual([other]);
    });

    it('同じ作者・ID は最初に知った 1 件にし、ID・作者の順に並べる', () => {
        const first = mod('bob@peer.example', 'pen', '2.0.0');
        const again = mod('bob@peer.example', 'pen', '1.0.0');
        const brush = mod('amy@other.example', 'brush');
        const penByAmy = mod('amy@other.example', 'pen');
        expect(
            mergePeerMods(
                [
                    [first, brush],
                    [again, penByAmy],
                ],
                SELF,
            ),
        ).toEqual([brush, penByAmy, first]);
    });
});

function setup(pages: Record<string, unknown[]>, peers = Object.keys(pages)) {
    const state = { now: 0, peers: peers.map((baseUrl) => ({ baseUrl })) };
    const fetchPage = vi.fn(async (baseUrl: string, offset: number) => {
        const body = pages[baseUrl]?.[offset / 20];
        if (body instanceof Error) throw body;
        return body ?? { items: [], nextOffset: null };
    });
    const onError = vi.fn();
    const catalog = createFederatedModCatalog({
        peers: async () => state.peers,
        fetchPage,
        selfDomain: () => SELF,
        now: () => state.now,
        onError,
    });
    return { catalog, fetchPage, onError, state };
}

describe('createFederatedModCatalog', () => {
    const A = 'https://a.example';
    const B = 'https://b.example';
    const pen = mod('bob@a.example', 'pen');
    const brush = mod('amy@b.example', 'brush');

    it('検索語はピアへ送らず、期限内は検索語が変わっても取り直さない', async () => {
        const { catalog, fetchPage } = setup({
            [A]: [{ items: [pen], nextOffset: null }],
            [B]: [{ items: [brush], nextOffset: null }],
        });
        expect((await catalog.search('pen')).items).toEqual([pen]);
        expect((await catalog.search('brush')).items).toEqual([brush]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(fetchPage.mock.calls).toEqual([
            [A, 0],
            [B, 0],
        ]);
    });

    it('期限が切れたら取り直す', async () => {
        const { catalog, fetchPage, state } = setup({ [A]: [{ items: [pen], nextOffset: null }] });
        await catalog.search('');
        state.now = PEER_MOD_TTL_MS - 1;
        await catalog.search('');
        expect(fetchPage).toHaveBeenCalledTimes(1);
        state.now = PEER_MOD_TTL_MS;
        await catalog.search('');
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('取れなかったサーバーは前に取れた一覧を使い、一度も取れていなければ空にする（ほかのサーバーは出す）', async () => {
        const pages: Record<string, unknown[]> = {
            [A]: [{ items: [pen], nextOffset: null }],
            [B]: [new Error('down')],
        };
        const { catalog, onError, state } = setup(pages);
        expect((await catalog.search('')).items).toEqual([pen]);
        expect(onError).toHaveBeenCalledWith(B, expect.any(Error));
        pages[A] = [new Error('down')];
        state.now = PEER_MOD_TTL_MS;
        expect((await catalog.search('')).items).toEqual([pen]);
    });

    it('同時の検索でも、1 つのサーバーへの取得は 1 回にまとめる', async () => {
        const { catalog, fetchPage } = setup({ [A]: [{ items: [pen], nextOffset: null }] });
        await Promise.all([catalog.search('a'), catalog.search('b'), catalog.search('c')]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('次のページを上限まで辿り、進まない nextOffset では止まる', async () => {
        const many = Array.from({ length: PEER_MOD_PAGES + 2 }, (_, i) => ({
            items: [mod('bob@a.example', `mod-${i}`)],
            nextOffset: (i + 1) * 20,
        }));
        const { catalog, fetchPage } = setup({ [A]: many });
        expect((await catalog.search('')).items).toHaveLength(PEER_MOD_PAGES);
        expect(fetchPage).toHaveBeenCalledTimes(PEER_MOD_PAGES);

        const loop = setup({ [B]: [{ items: [brush], nextOffset: 0 }] });
        await loop.catalog.search('');
        expect(loop.fetchPage).toHaveBeenCalledTimes(1);
    });

    it('フォローを外したサーバーの mod は、期限内でも出さない', async () => {
        const { catalog, state } = setup({
            [A]: [{ items: [pen], nextOffset: null }],
            [B]: [{ items: [brush], nextOffset: null }],
        });
        await catalog.search('');
        state.peers = [{ baseUrl: B }];
        expect((await catalog.search('')).items).toEqual([brush]);
    });

    it('返す件数には上限がある', async () => {
        const items = Array.from({ length: FEDERATED_MOD_LIMIT + 5 }, (_, i) => mod('bob@a.example', `mod-${i}`));
        const { catalog } = setup({ [A]: [{ items, nextOffset: null }] });
        expect((await catalog.search('')).items).toHaveLength(FEDERATED_MOD_LIMIT);
    });
});
