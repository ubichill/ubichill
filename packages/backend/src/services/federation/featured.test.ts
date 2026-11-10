import type { FavoritesVisibility } from '@ubichill/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer, createFeatured, type FeaturedSource } from './featured';
import { createFederationIdentity } from './identity';

const identity = createFederationIdentity('https://api.example');
const PROFILE = 'https://app.example';
const day = (n: number) => new Date(Date.UTC(2026, 10, n));

const source = (id: string, n: number, patch: Partial<FeaturedSource> = {}): FeaturedSource => ({
    name: id,
    description: null,
    image: null,
    path: `/world/${id}`,
    published: day(n),
    ...patch,
});

function setup(
    options: {
        visibility?: FavoritesVisibility;
        worlds?: FeaturedSource[];
        mods?: FeaturedSource[] | Error;
        favorites?: FeaturedSource[];
    } = {},
) {
    const calls = { worlds: 0, favorites: 0 };
    const logs: string[] = [];
    const featured = createFeatured({
        identity,
        profileOrigin: PROFILE,
        findUser: async (id) => (id === 'alice' ? { id, handle: 'alice' } : undefined),
        sources: {
            worlds: async () => {
                calls.worlds++;
                return options.worlds ?? [];
            },
            mods: async () => {
                if (options.mods instanceof Error) throw options.mods;
                return options.mods ?? [];
            },
            favorites: async () => {
                calls.favorites++;
                return options.favorites ?? [];
            },
        },
        favoritesVisibility: async () => options.visibility ?? 'public',
        log: (m) => void logs.push(m),
    });
    return { featured, calls, logs };
}

type Note = { id: string; content: string; attachment?: Array<{ url: string; mediaType: string }> };
const notesOf = async (featured: ReturnType<typeof setup>['featured']) =>
    ((await featured.collection('alice')) as { orderedItems: Note[] } | undefined)?.orderedItems ?? [];
const keyOf = (note: Note | undefined) => note?.id.slice(note.id.lastIndexOf('/') + 1) ?? '';

describe('フェディバースの固定ノート', () => {
    it('作ったワールド・mod・お気に入りを種類ごとに 1 つのノートにまとめ、それぞれ新しい順に並べる', async () => {
        const { featured } = setup({
            worlds: [source('w1', 1), source('w2', 3), source('w3', 2)],
            mods: [source('m1', 1, { version: '1.0.0', path: '/@alice' }), source('m2', 2, { path: '/@alice' })],
            favorites: [source('f1', 5), source('f2', 4)],
        });
        const notes = await notesOf(featured);
        expect(notes.map((n) => keyOf(n)[0])).toEqual(['w', 'm', 'f']);
        const namesIn = (note: Note | undefined) =>
            [...(note?.content ?? '').matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
        expect(notes.map(namesIn)).toEqual([
            ['w2', 'w3', 'w1'],
            ['m2', 'm1'],
            ['f1', 'f2'],
        ]);
        expect(notes[0]?.content).toContain(`href="${PROFILE}/world/w2"`);
        expect(notes[1]?.content).toContain('>m1</a> v1.0.0');
    });

    it('お気に入りは公開範囲がパブリックのときだけ出す（フレンドだけ・本人だけなら材料も読まない）', async () => {
        for (const visibility of ['friends', 'private'] as const) {
            const { featured, calls } = setup({ visibility, favorites: [source('f1', 1)] });
            expect(await notesOf(featured)).toEqual([]);
            expect(calls.favorites).toBe(0);
        }
        const { featured } = setup({ visibility: 'public', favorites: [source('f1', 1)] });
        expect(await notesOf(featured)).toHaveLength(1);
    });

    it('ノートの id は中身が同じなら同じで、取りに来られたら同じノートを返す', async () => {
        const { featured } = setup({ worlds: [source('w1', 1, { image: '/api/v1/worlds/w1/thumbnail.png' })] });
        const [note] = await notesOf(featured);
        const key = keyOf(note);
        expect(key).toMatch(/^w-[A-Za-z0-9_-]{16}$/);
        featured.invalidate('alice');
        expect(keyOf((await notesOf(featured))[0])).toBe(key);
        expect(await featured.note('alice', key)).toMatchObject({
            id: note?.id,
            type: 'Note',
            attributedTo: identity.actorUrl('alice'),
            cc: [identity.followersUrl('alice')],
            // 画像は API のオリジンで絶対 URL にする
            attachment: [{ url: 'https://api.example/api/v1/worlds/w1/thumbnail.png', mediaType: 'image/png' }],
        });
        expect(await featured.note('alice', 'w-unknown')).toBeUndefined();
        expect(await featured.note('ghost', key)).toBeUndefined();
        expect(await featured.collection('ghost')).toBeUndefined();
    });

    it('中身（項目の追加・名前・サムネイル）が変わったら id を変え、前の id は返さない（相手は同じ id を取り直さない）', async () => {
        const keys = await Promise.all(
            [
                [source('w1', 1)],
                [source('w1', 1), source('w2', 2)],
                [source('w1', 1, { name: 'renamed' })],
                [source('w1', 1, { image: '/thumb.png' })],
            ].map(async (worlds) => keyOf((await notesOf(setup({ worlds }).featured))[0])),
        );
        expect(new Set(keys).size).toBe(keys.length);
        const { featured } = setup({ worlds: [source('w1', 1)] });
        expect(await featured.note('alice', keys[1] ?? '')).toBeUndefined();
    });

    it('材料の 1 つが読めなくても、ほかの材料で出す', async () => {
        const { featured, logs } = setup({ worlds: [source('w1', 1)], mods: new Error('timeout') });
        expect(await notesOf(featured)).toHaveLength(1);
        expect(logs[0]).toContain('timeout');
    });

    it('http(s) でないリンクの項目は出さず、http(s) でない画像は添付しない', async () => {
        const { featured } = setup({
            worlds: [
                source('bad', 2, { path: 'javascript:alert(1)' }),
                source('w1', 1, { image: 'data:image/png;base64,AAAA' }),
            ],
        });
        const notes = await notesOf(featured);
        expect(notes).toHaveLength(1);
        expect(notes[0]?.content).not.toContain('javascript:');
        expect(notes[0]?.content).toContain(`${PROFILE}/world/w1`);
        expect(notes[0]?.attachment).toBeUndefined();
    });

    it('少しの間は覚え、変わったと知らされたら作り直す', async () => {
        const { featured, calls } = setup({ worlds: [source('w1', 1)] });
        await featured.collection('alice');
        await featured.collection('alice');
        expect(calls.worlds).toBe(1);
        featured.invalidate('alice');
        await featured.collection('alice');
        expect(calls.worlds).toBe(2);
    });
});

describe('createDebouncer', () => {
    afterEach(() => void vi.useRealTimers());

    it('同じユーザーの続けての変更は、最後の変更から待って 1 度だけ走らせる。ユーザーごとに別', () => {
        vi.useFakeTimers();
        const runs: string[] = [];
        const debounce = createDebouncer((id) => void runs.push(id), 1000);
        debounce('alice');
        vi.advanceTimersByTime(900);
        debounce('alice');
        debounce('bob');
        vi.advanceTimersByTime(900);
        expect(runs).toEqual([]);
        vi.advanceTimersByTime(100);
        expect(runs).toEqual(['alice', 'bob']);
        vi.advanceTimersByTime(5000);
        expect(runs).toEqual(['alice', 'bob']);
    });
});
