import { describe, expect, it } from 'vitest';
import {
    buildFeaturedCollection,
    buildFeaturedNote,
    FEATURED_IMAGES_PER_NOTE,
    FEATURED_ITEMS_PER_NOTE,
    type FeaturedItem,
    featuredNoteContent,
    imageMediaType,
    PUBLIC_AUDIENCE,
    pickFeatured,
} from './featured';

const item = (name: string, n: number, patch: Partial<FeaturedItem> = {}): FeaturedItem => ({
    name,
    description: null,
    image: null,
    link: `https://app.example/${name}`,
    published: new Date(Date.UTC(2026, 0, n)).toISOString(),
    ...patch,
});

const none = { world: [], mod: [], favorite: [] };

describe('固定ノートを選ぶ', () => {
    it('種類ごとに 1 つのグループで、それぞれ新しい順（作ったワールド → mod → お気に入り）', () => {
        const groups = pickFeatured({
            world: [item('w1', 1), item('w3', 3), item('w2', 2)],
            mod: [item('m1', 4)],
            favorite: [item('f1', 1), item('f9', 9)],
        });
        expect(groups.map((g) => [g.kind, g.items.map((i) => i.name)])).toEqual([
            ['world', ['w3', 'w2', 'w1']],
            ['mod', ['m1']],
            ['favorite', ['f9', 'f1']],
        ]);
    });

    it(`1 つのノートに並べるのは新しい順に ${FEATURED_ITEMS_PER_NOTE} 件まで`, () => {
        const many = Array.from({ length: FEATURED_ITEMS_PER_NOTE + 3 }, (_, i) => item(`w${i + 1}`, i + 1));
        const [group] = pickFeatured({ ...none, world: many });
        expect(group?.items).toHaveLength(FEATURED_ITEMS_PER_NOTE);
        expect(group?.items[0]?.name).toBe(`w${FEATURED_ITEMS_PER_NOTE + 3}`);
    });

    it('自分で作ったワールドをお気に入りにしていたら、お気に入りには出さない（それだけならお気に入りのノートは作らない）', () => {
        const own = item('forest', 1);
        expect(pickFeatured({ ...none, world: [own], favorite: [item('forest', 9)] }).map((g) => g.kind)).toEqual([
            'world',
        ]);
    });

    it('項目の無い種類はノートを作らない', () => {
        expect(pickFeatured(none)).toEqual([]);
        expect(pickFeatured({ ...none, mod: [item('m', 1)] }).map((g) => g.kind)).toEqual(['mod']);
    });
});

describe('固定ノートの形', () => {
    it('本文は見出しと、項目ごとに名前のリンク・版・説明。名前・説明・リンクはエスケープする', () => {
        expect(
            featuredNoteContent({
                kind: 'mod',
                items: [
                    item('<script>x</script>', 1, {
                        version: '1.2.0',
                        description: 'a & b',
                        link: 'https://app.example/@alice?x="1"',
                    }),
                    item('pen', 2),
                ],
            }),
        ).toBe(
            '<p>公開している mod</p>' +
                '<p><a href="https://app.example/@alice?x=&quot;1&quot;" rel="nofollow noopener" target="_blank">&lt;script&gt;x&lt;/script&gt;</a> v1.2.0<br>a &amp; b</p>' +
                '<p><a href="https://app.example/pen" rel="nofollow noopener" target="_blank">pen</a></p>',
        );
        expect(featuredNoteContent({ kind: 'world', items: [item('w', 1)] })).toMatch(/^<p>作ったワールド<\/p>/);
        expect(featuredNoteContent({ kind: 'favorite', items: [item('f', 1)] })).toMatch(
            /^<p>お気に入りのワールド<\/p>/,
        );
    });

    it('ノートは公開で、フォロワーにも宛てる。時刻は先頭（いちばん新しい）の項目のもの', () => {
        const note = buildFeaturedNote({
            id: 'https://a.example/ap/users/alice/featured/w-1',
            actor: 'https://a.example/ap/users/alice',
            followers: 'https://a.example/ap/users/alice/followers',
            group: { kind: 'world', items: [item('new', 5), item('old', 1)] },
        });
        expect(note).toMatchObject({
            type: 'Note',
            attributedTo: 'https://a.example/ap/users/alice',
            to: [PUBLIC_AUDIENCE],
            cc: ['https://a.example/ap/users/alice/followers'],
            published: item('new', 5).published,
        });
        expect(note.attachment).toBeUndefined();
    });

    it(`画像は種類が分かるものだけ、並びの順に ${FEATURED_IMAGES_PER_NOTE} 枚まで添付する`, () => {
        const items = [
            item('a', 9, { image: 'https://a.example/a.WEBP?v=2' }),
            item('b', 8, { image: 'https://a.example/thumbnail' }),
            ...Array.from({ length: FEATURED_IMAGES_PER_NOTE + 1 }, (_, i) =>
                item(`c${i}`, 7 - i, { image: `https://a.example/c${i}.png` }),
            ),
        ];
        const note = buildFeaturedNote({ id: 'x', actor: 'a', followers: 'f', group: { kind: 'world', items } });
        const attachment = note.attachment as Array<{ url: string; mediaType: string; name: string }>;
        expect(attachment).toHaveLength(FEATURED_IMAGES_PER_NOTE);
        expect(attachment[0]).toEqual({
            type: 'Document',
            mediaType: 'image/webp',
            url: 'https://a.example/a.WEBP?v=2',
            name: 'a',
        });
        expect(attachment.map((a) => a.name)).not.toContain('b');
    });

    it('コレクションはノートを埋め込み、件数を持つ（埋め込んだノートに @context を重ねない）', () => {
        const note = buildFeaturedNote({
            id: 'n1',
            actor: 'a',
            followers: 'f',
            group: { kind: 'world', items: [item('w', 1)] },
        });
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
