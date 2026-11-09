import { describe, expect, it } from 'vitest';
import {
    buildFeaturedCollection,
    buildFeaturedNote,
    type FeaturedItem,
    featuredNoteContent,
    imageMediaType,
    PUBLIC_AUDIENCE,
    pickFeatured,
} from './featured';

const item = (kind: FeaturedItem['kind'], n: number, patch: Partial<FeaturedItem> = {}): FeaturedItem => ({
    kind,
    key: `${kind}-${n}`,
    name: `${kind} ${n}`,
    description: null,
    image: null,
    link: `https://app.example/${kind}/${n}`,
    published: new Date(Date.UTC(2026, 0, n)).toISOString(),
    ...patch,
});

describe('固定ノートを選ぶ', () => {
    it('種類ごとに新しい順で、作ったワールド 2・mod 2・お気に入り 1 まで（ほかの実装は 5 件まで読む）', () => {
        const picked = pickFeatured({
            worlds: [item('world', 1), item('world', 3), item('world', 2)],
            mods: [item('mod', 4), item('mod', 6), item('mod', 5)],
            favorites: [item('favorite', 1), item('favorite', 9)],
        });
        expect(picked.map((i) => i.key)).toEqual(['world-3', 'world-2', 'mod-6', 'mod-5', 'favorite-9']);
    });

    it('自分で作ったワールドをお気に入りにしていたら、お気に入りには出さず、次のお気に入りを出す', () => {
        const own = item('world', 1, { link: 'https://app.example/@alice/forest' });
        const picked = pickFeatured({
            worlds: [own],
            mods: [],
            favorites: [item('favorite', 9, { link: own.link }), item('favorite', 2)],
        });
        expect(picked.map((i) => i.key)).toEqual(['world-1', 'favorite-2']);
    });

    it('無い種類は詰めずに、あるものだけ出す', () => {
        expect(pickFeatured({ worlds: [], mods: [], favorites: [] })).toEqual([]);
        expect(pickFeatured({ worlds: [], mods: [item('mod', 1)], favorites: [] })).toHaveLength(1);
    });
});

describe('固定ノートの形', () => {
    it('本文は種類の見出しと名前・説明・リンク。名前と説明はエスケープする', () => {
        expect(
            featuredNoteContent(
                item('mod', 1, {
                    name: '<script>x</script>',
                    version: '1.2.0',
                    description: 'a & b',
                    link: 'https://app.example/@alice?x="1"',
                }),
            ),
        ).toBe(
            '<p>公開している mod「&lt;script&gt;x&lt;/script&gt;」 v1.2.0</p><p>a &amp; b</p>' +
                '<p><a href="https://app.example/@alice?x=&quot;1&quot;" rel="nofollow noopener" target="_blank">https://app.example/@alice?x=&quot;1&quot;</a></p>',
        );
        expect(featuredNoteContent(item('world', 1))).toContain('作ったワールド「world 1」');
        expect(featuredNoteContent(item('favorite', 1))).toContain('お気に入りのワールド「favorite 1」');
    });

    it('ノートは公開で、フォロワーにも宛てる。画像は種類が分かるときだけ添付する', () => {
        const note = buildFeaturedNote({
            id: 'https://a.example/ap/users/alice/featured/w-1',
            actor: 'https://a.example/ap/users/alice',
            followers: 'https://a.example/ap/users/alice/followers',
            item: item('world', 1, { image: 'https://a.example/thumb.WEBP?v=2' }),
        });
        expect(note).toMatchObject({
            type: 'Note',
            attributedTo: 'https://a.example/ap/users/alice',
            to: [PUBLIC_AUDIENCE],
            cc: ['https://a.example/ap/users/alice/followers'],
            url: 'https://app.example/world/1',
            attachment: [{ type: 'Document', mediaType: 'image/webp', url: 'https://a.example/thumb.WEBP?v=2' }],
        });
        const noImageType = buildFeaturedNote({
            id: 'x',
            actor: 'a',
            followers: 'f',
            item: item('world', 1, { image: 'https://a.example/thumbnail' }),
        });
        expect(noImageType.attachment).toBeUndefined();
    });

    it('コレクションはノートを埋め込み、件数を持つ（埋め込んだノートに @context を重ねない）', () => {
        const note = buildFeaturedNote({ id: 'n1', actor: 'a', followers: 'f', item: item('world', 1) });
        const collection = buildFeaturedCollection({ id: 'c', notes: [note] });
        expect(collection).toMatchObject({ type: 'OrderedCollection', totalItems: 1 });
        expect((collection.orderedItems as Array<Record<string, unknown>>)[0]?.['@context']).toBeUndefined();
        expect(note['@context']).toBeDefined();
    });

    it('画像の種類は拡張子から（クエリ・フラグメントは見ない）', () => {
        expect(imageMediaType('https://x/a.jpg#frag')).toBe('image/jpeg');
        expect(imageMediaType('https://x/a.png?w=100')).toBe('image/png');
        expect(imageMediaType('https://x/a.svg')).toBeNull();
        expect(imageMediaType('https://x/no-ext')).toBeNull();
    });
});
