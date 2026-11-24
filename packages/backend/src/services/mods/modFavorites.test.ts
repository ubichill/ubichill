import { LIMITS, type ModFavoriteRef, type PackageDescriptor } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createModFavorites } from './modFavorites';
import type { ModLookup } from './modLookup';

const ref = (id: string, author = 'alice@ubichill.test'): ModFavoriteRef => ({ author, id });
const descriptor = (r: ModFavoriteRef, version = '1.2.0'): PackageDescriptor => ({
    ...r,
    version,
    baseUrl: `https://${r.author.split('@')[1]}/mods`,
});

/** 配列で作った偽物。lookup は表に無い mod を missing にする。 */
function setup(catalog: Record<string, ModLookup> = {}) {
    const rows = new Map<string, ModFavoriteRef[]>();
    const calls = { lookups: [] as string[], changed: [] as string[] };
    const key = (r: ModFavoriteRef) => `@${r.author}/${r.id}`;
    const service = createModFavorites({
        list: async (userId) => [...(rows.get(userId) ?? [])],
        addWithinLimit: async (userId, r, max) => {
            const list = rows.get(userId) ?? [];
            if (list.some((x) => key(x) === key(r))) return 'exists';
            if (list.length >= max) return 'limit';
            rows.set(userId, [r, ...list]);
            return 'added';
        },
        remove: async (userId, r) => {
            rows.set(
                userId,
                (rows.get(userId) ?? []).filter((x) => key(x) !== key(r)),
            );
        },
        lookup: async (r) => {
            calls.lookups.push(key(r));
            return catalog[key(r)] ?? { status: 'missing' };
        },
        changed: (userId) => calls.changed.push(userId),
    });
    return { service, rows, calls };
}

const found = (r: ModFavoriteRef, version?: string): ModLookup => ({
    status: 'found',
    descriptor: descriptor(r, version),
});

describe('createModFavorites: 足す', () => {
    it('作者のカタログにある mod を足し、一覧が変わったことを知らせる', async () => {
        const { service, rows, calls } = setup({ '@alice@ubichill.test/pen': found(ref('pen')) });
        expect(await service.add('u1', ref('pen'))).toEqual({ ok: true, mod: ref('pen') });
        expect(rows.get('u1')).toEqual([ref('pen')]);
        expect(calls.changed).toEqual(['u1']);
    });

    it('2 回足しても 1 件。2 回目は作者のサーバーに問い合わせず、知らせもしない', async () => {
        const { service, rows, calls } = setup({ '@alice@ubichill.test/pen': found(ref('pen')) });
        await service.add('u1', ref('pen'));
        expect(await service.add('u1', ref('pen'))).toEqual({ ok: true, mod: ref('pen') });
        expect(rows.get('u1')).toHaveLength(1);
        expect(calls.lookups).toHaveLength(1);
        expect(calls.changed).toHaveLength(1);
    });

    it('カタログに無い mod は 404 で、何も残さない', async () => {
        const { service, rows, calls } = setup();
        expect(await service.add('u1', ref('ghost'))).toMatchObject({ ok: false, status: 404 });
        expect(rows.get('u1')).toBeUndefined();
        expect(calls.changed).toEqual([]);
    });

    it('作者のサーバーに届かなければ 503（無いとは言わない）', async () => {
        const { service, rows } = setup({ '@bob@far.test/pen': { status: 'unreachable' } });
        expect(await service.add('u1', ref('pen', 'bob@far.test'))).toMatchObject({ ok: false, status: 503 });
        expect(rows.get('u1')).toBeUndefined();
    });

    it('作者と ID の形が違うものは、カタログに問い合わせる前に 400', async () => {
        const { service, calls } = setup();
        for (const bad of [
            '@alice@ubichill.test/pen',
            null,
            { id: 'pen' },
            { author: 'alice', id: 'pen' },
            // 作者は正規の表記だけ（ドメインは小文字、先頭の @ なし）
            { author: 'alice@Ubichill.test', id: 'pen' },
            { author: '@alice@ubichill.test', id: 'pen' },
            { author: 'alice@ubichill.test', id: 'Pen' },
            { author: 'alice@ubichill.test', id: 'core' },
            { author: 'alice@ubichill.test', id: '../pen' },
        ]) {
            expect(await service.add('u1', bad)).toMatchObject({ ok: false, status: 400 });
        }
        expect(calls.lookups).toEqual([]);
    });

    it('余計な項目（版・取得先）は覚えない', async () => {
        const { service, rows } = setup({ '@alice@ubichill.test/pen': found(ref('pen')) });
        await service.add('u1', { ...ref('pen'), version: '9.9.9', baseUrl: 'https://evil.test' });
        expect(rows.get('u1')).toEqual([ref('pen')]);
    });

    it(`${LIMITS.MAX_FAVORITES_PER_USER} 件を超えては足せない。入っている mod を足し直すのは上限でも成功`, async () => {
        const many = Array.from({ length: LIMITS.MAX_FAVORITES_PER_USER }, (_, i) => ref(`m${i}`));
        const { service, rows, calls } = setup({
            '@alice@ubichill.test/one-more': found(ref('one-more')),
        });
        rows.set('u1', many);
        expect(await service.add('u1', ref('one-more'))).toMatchObject({ ok: false, status: 409 });
        expect(await service.add('u1', ref('m3'))).toEqual({ ok: true, mod: ref('m3') });
        expect(rows.get('u1')).toHaveLength(LIMITS.MAX_FAVORITES_PER_USER);
        expect(calls.changed).toEqual([]);
    });

    it('人ごとに別々', async () => {
        const { service, rows } = setup({ '@alice@ubichill.test/pen': found(ref('pen')) });
        await service.add('u1', ref('pen'));
        expect(rows.get('u2')).toBeUndefined();
        expect(await service.refs('u2')).toEqual([]);
    });
});

describe('createModFavorites: 外す', () => {
    it('外すと一覧から消え、知らせる。カタログには問い合わせない（公開をやめた mod も外せる）', async () => {
        const { service, rows, calls } = setup();
        rows.set('u1', [ref('pen'), ref('gone')]);
        expect(await service.remove('u1', ref('gone'))).toEqual({ ok: true, mod: ref('gone') });
        expect(rows.get('u1')).toEqual([ref('pen')]);
        expect(calls.lookups).toEqual([]);
        expect(calls.changed).toEqual(['u1']);
    });

    it('入っていない mod を外しても成功。形が違えば 400', async () => {
        const { service } = setup();
        expect(await service.remove('u1', ref('never'))).toMatchObject({ ok: true });
        expect(await service.remove('u1', { author: 'x', id: 'pen' })).toMatchObject({ ok: false, status: 400 });
    });
});

describe('createModFavorites: 一覧', () => {
    it('引けたものは今の版で、無い・届かない・失敗したものは unavailable に。順序は保つ', async () => {
        const { service, rows } = setup({
            '@alice@ubichill.test/pen': found(ref('pen'), '2.3.1'),
            '@bob@far.test/danmaku': { status: 'unreachable' },
            '@carol@peer.test/wasm': found(ref('wasm', 'carol@peer.test')),
        });
        rows.set('u1', [ref('pen'), ref('danmaku', 'bob@far.test'), ref('gone'), ref('wasm', 'carol@peer.test')]);
        expect(await service.resolved('u1')).toEqual({
            mods: [descriptor(ref('pen'), '2.3.1'), descriptor(ref('wasm', 'carol@peer.test'))],
            unavailable: [ref('danmaku', 'bob@far.test'), ref('gone')],
        });
        expect(await service.visible('u1')).toEqual([
            descriptor(ref('pen'), '2.3.1'),
            descriptor(ref('wasm', 'carol@peer.test')),
        ]);
    });

    it('引く処理が例外を投げても一覧は返す（その mod は unavailable）', async () => {
        const service = createModFavorites({
            list: async () => [ref('pen'), ref('boom')],
            addWithinLimit: async () => 'added',
            remove: async () => undefined,
            lookup: async (r) => {
                if (r.id === 'boom') throw new Error('down');
                return found(r);
            },
            changed: () => undefined,
        });
        expect(await service.resolved('u1')).toEqual({ mods: [descriptor(ref('pen'))], unavailable: [ref('boom')] });
    });

    it('同時に引くのは 8 件まで（作者のサーバーへの取得を集中させない）', async () => {
        const state = { running: 0, max: 0 };
        const service = createModFavorites({
            list: async () => Array.from({ length: 30 }, (_, i) => ref(`m${i}`)),
            addWithinLimit: async () => 'added',
            remove: async () => undefined,
            lookup: async (r) => {
                state.running += 1;
                state.max = Math.max(state.max, state.running);
                await new Promise((resolve) => setTimeout(resolve, 2));
                state.running -= 1;
                return found(r);
            },
            changed: () => undefined,
        });
        expect((await service.resolved('u1')).mods).toHaveLength(30);
        expect(state.max).toBe(8);
    });
});
