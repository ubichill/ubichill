import { describe, expect, it } from 'vitest';
import { buildActorDocument, readActorDocument } from '../actor';
import { keyIdOf } from '../protocol';
import { ed25519Multikey } from '../ubichill/multikey';
import {
    MAX_REMOTE_PROFILE_FIELDS,
    PROFILE_FIELD_NAMES,
    profileAttachment,
    REMOTE_PROFILE_FIELD_NAME_MAX,
    REMOTE_PROFILE_FIELD_VALUE_MAX,
    readProfileAttachment,
    remoteProfileView,
    remoteStatusOf,
} from './profileFields';

const ALICE = 'https://a.example/ap/users/alice';

const actorOf = (patch: Partial<Parameters<typeof buildActorDocument>[0]> = {}) =>
    buildActorDocument({
        id: ALICE,
        type: 'Person',
        preferredUsername: 'alice',
        name: 'Alice',
        inbox: `${ALICE}/inbox`,
        sharedInbox: 'https://a.example/ap/inbox',
        keyId: keyIdOf(ALICE),
        publicKeyMultibase: ed25519Multikey(new Uint8Array(32)),
        ...patch,
    });

describe('プロフィールの項目をほかの実装に載せる', () => {
    it('リンク（rel="me"）→ 話せる言語 → ひとこと の順。Web サイトはホスト名、ほかはサービス名', () => {
        expect(
            profileAttachment({
                status: '<b>ねむい</b>',
                links: [
                    { url: 'https://github.com/alice', kind: 'github' },
                    { url: 'https://alice.example/blog/', kind: 'website' },
                ],
                languages: ['ja', 'en'],
            }),
        ).toEqual([
            {
                type: 'PropertyValue',
                name: 'GitHub',
                value: '<a href="https://github.com/alice" rel="me nofollow noopener" target="_blank">github.com/alice</a>',
            },
            {
                type: 'PropertyValue',
                name: 'alice.example',
                value: '<a href="https://alice.example/blog/" rel="me nofollow noopener" target="_blank">alice.example/blog</a>',
            },
            { type: 'PropertyValue', name: PROFILE_FIELD_NAMES.languages, value: '日本語 / English' },
            { type: 'PropertyValue', name: PROFILE_FIELD_NAMES.status, value: '&lt;b&gt;ねむい&lt;/b&gt;' },
        ]);
    });

    it('何も無ければ attachment も拡張の語も載せない', () => {
        const doc = actorOf({ profile: { status: null, links: [], languages: [] } });
        expect(doc.attachment).toBeUndefined();
        expect(doc.statusMessage).toBeUndefined();
        expect(doc.spokenLanguages).toBeUndefined();
    });

    it('バナーは image、作った時刻は published に載せる', () => {
        expect(actorOf({ banner: 'https://a.example/b.webp', published: '2026-01-02T00:00:00.000Z' })).toMatchObject({
            image: { type: 'Image', url: 'https://a.example/b.webp' },
            published: '2026-01-02T00:00:00.000Z',
        });
    });
});

describe('ほかの実装の項目の表を読む', () => {
    it('Mastodon のリンク（span で分けた URL）は文字に戻し、href を取る', () => {
        expect(
            readProfileAttachment([
                {
                    type: 'PropertyValue',
                    name: 'Web',
                    value: '<a href="https://x.example/@a?x=1&amp;y=2" target="_blank" rel="nofollow noopener noreferrer me" translate="no"><span class="invisible">https://</span><span class="">x.example/@a</span><span class="invisible"></span></a>',
                },
                { type: 'PropertyValue', name: 'Location', value: 'Tokyo &amp; Osaka' },
            ]),
        ).toEqual([
            { name: 'Web', value: 'https://x.example/@a', href: 'https://x.example/@a?x=1&y=2' },
            { name: 'Location', value: 'Tokyo & Osaka', href: null },
        ]);
    });

    it('https でないリンクは href にしない。PropertyValue でないもの・空のものは飛ばす。1 つだけでも読む', () => {
        expect(
            readProfileAttachment([
                { type: 'PropertyValue', name: 'x', value: "<a href='javascript:alert(1)'>click</a>" },
                { type: 'PropertyValue', name: 'y', value: '<a href="http://plain.example/">plain</a>' },
                { type: 'Hashtag', name: '#tag', href: 'https://m.example/tags/tag' },
                { type: 'PropertyValue', name: '', value: 'no name' },
                { type: 'PropertyValue', name: 'no value', value: '<p></p>' },
                'garbage',
            ]),
        ).toEqual([
            { name: 'x', value: 'click', href: null },
            { name: 'y', value: 'plain', href: null },
        ]);
        expect(readProfileAttachment({ type: 'PropertyValue', name: 'a', value: 'b' })).toHaveLength(1);
        expect(readProfileAttachment(undefined)).toEqual([]);
    });

    it(`読むのは ${MAX_REMOTE_PROFILE_FIELDS} 件まで`, () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ type: 'PropertyValue', name: `n${i}`, value: `v${i}` }));
        expect(readProfileAttachment(many)).toHaveLength(MAX_REMOTE_PROFILE_FIELDS);
    });
});

describe('ほかのサーバーの人のプロフィール（保存した形から表示の形へ）', () => {
    it('ubichill どうしは往復で元に戻る（項目の表に重ねて出さない）', () => {
        const profile = {
            status: 'ねむい',
            links: [
                { url: 'https://github.com/alice', kind: 'github' as const },
                { url: 'https://alice.example/', kind: 'website' as const },
            ],
            languages: ['ja', 'ko'],
        };
        const read = readActorDocument(actorOf({ profile, banner: 'https://a.example/b.webp' }), ALICE);
        if (!read.ok) throw new Error('読めない');
        expect(read.actor.banner).toBe('https://a.example/b.webp');
        const view = remoteProfileView({
            fields: read.actor.fields,
            status: read.actor.statusMessage,
            languages: read.actor.spokenLanguages,
        });
        expect(view).toEqual({ ...profile, fields: [], bioSegments: null, emojis: [] });
    });

    it('Misskey の人: リンクの項目はリンクに、それ以外は表に。ひとこと・言語の名前の項目も、拡張の語が無ければ表に残す', () => {
        const view = remoteProfileView({
            fields: [
                { name: 'X', value: 'x.com/syuilo', href: 'https://x.com/syuilo' },
                { name: '場所', value: '東京', href: null },
                { name: PROFILE_FIELD_NAMES.status, value: 'ひとことの名前の項目', href: null },
            ],
        });
        expect(view.links).toEqual([{ url: 'https://x.com/syuilo', kind: 'x' }]);
        expect(view.fields).toEqual([
            { name: '場所', value: '東京' },
            { name: PROFILE_FIELD_NAMES.status, value: 'ひとことの名前の項目' },
        ]);
        expect(view.status).toBeNull();
    });

    it('リンクは 5 件まで。同じリンクは 1 つにまとめ、あふれた分は表に残す（失わない）', () => {
        const link = (i: number) => ({ name: `L${i}`, value: `site${i}`, href: `https://site${i}.example/` });
        const view = remoteProfileView({
            fields: [link(1), link(1), link(2), link(3), link(4), link(5), link(6)],
        });
        expect(view.links.map((l) => l.url)).toEqual([1, 2, 3, 4, 5].map((i) => `https://site${i}.example/`));
        // 6 件目はリンクの欄にあふれたので、表に残す（失わない。行き先も持つ）
        expect(view.fields).toEqual([{ name: 'L6', value: 'site6', href: 'https://site6.example/' }]);
    });

    it('保存した形が壊れていても読める（形の違う項目だけ捨てる）', () => {
        const empty = { bioSegments: null, emojis: [] };
        expect(remoteProfileView(null)).toEqual({ status: null, links: [], languages: [], fields: [], ...empty });
        expect(remoteProfileView({ fields: 'x', status: 3, languages: ['ja', 'xx', 1], bio: 'x', emojis: {} })).toEqual(
            {
                status: null,
                links: [],
                languages: ['ja'],
                fields: [],
                ...empty,
            },
        );
        // ひとことは 1 行・60 文字に整え直す
        expect(remoteProfileView({ status: `<b>a</b>\n${'あ'.repeat(100)}` }).status).toHaveLength(60);
    });

    it('保存した項目が長すぎ・多すぎても、取り込むときと同じ長さと数に切って返す（巨大な行でもプロフィールを開ける）', () => {
        const huge = { name: 'な'.repeat(100_000), value: 'あ'.repeat(100_000), href: null };
        const many = Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, value: `v${i}`, href: null }));
        const view = remoteProfileView({ fields: [huge, ...many] });
        expect(view.fields[0]?.name).toHaveLength(REMOTE_PROFILE_FIELD_NAME_MAX);
        expect(view.fields[0]?.value).toHaveLength(REMOTE_PROFILE_FIELD_VALUE_MAX);
        expect(view.fields).toHaveLength(MAX_REMOTE_PROFILE_FIELDS);
    });

    it('保存した文字はもう一度タグとして扱わない（文字の < > を消さない）。空の項目は出さない', () => {
        const view = remoteProfileView({
            fields: [
                { name: '式', value: 'a < b > c', href: null },
                { name: '  ', value: 'x', href: null },
            ],
        });
        expect(view.fields).toEqual([{ name: '式', value: 'a < b > c' }]);
    });

    it('同じ名前と値の項目は 1 つにする', () => {
        const row = { name: 'a', value: 'b', href: null };
        expect(remoteProfileView({ fields: [row, row] }).fields).toEqual([{ name: 'a', value: 'b' }]);
    });
});

describe('remoteStatusOf', () => {
    it('一覧のカードに出すひとことを、プロフィールと同じ規則で整える（空・タグだけ・壊れた形は無し）', () => {
        expect(remoteStatusOf({ status: ' <i>ねむい</i> ' })).toBe('ねむい');
        expect(remoteStatusOf({ status: '<b></b>' })).toBeNull();
        expect(remoteStatusOf({ status: 3 })).toBeNull();
        expect(remoteStatusOf('x')).toBeNull();
        const long = { status: 'あ'.repeat(100) };
        expect(remoteStatusOf(long)).toBe(remoteProfileView(long).status);
    });
});
