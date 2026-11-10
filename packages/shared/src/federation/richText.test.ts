import { describe, expect, it } from 'vitest';
import {
    clipRichText,
    MAX_CUSTOM_EMOJIS,
    richTextPlain,
    splitCustomEmojis,
    storedCustomEmojisOf,
    storedRichTextOf,
} from '../user/richText';
import { htmlToRichText, readCustomEmojis } from './richText';

// mi.youkan.uk の actor の summary（2026-11-10 に取ったもの）
const MISSKEY_SUMMARY =
    '<i>ねこ</i><br />​:pple:​の店員さん！<br /><a href="https://pple.vr2.info/">ぷぷりえの公式サイト</a><br />' +
    'mi.youkan.ukの管理者<br /><br /><a href="https://youkan.uk/">ようかんのホームページ</a>';

describe('htmlToRichText', () => {
    it('Misskey の自己紹介: 文字の違うリンクの行き先を残し、改行と空行を保つ', () => {
        expect(htmlToRichText(MISSKEY_SUMMARY, 1500)).toEqual([
            { kind: 'text', text: 'ねこ\n​:pple:​の店員さん！\n' },
            { kind: 'link', text: 'ぷぷりえの公式サイト', href: 'https://pple.vr2.info/' },
            { kind: 'text', text: '\nmi.youkan.ukの管理者\n\n' },
            { kind: 'link', text: 'ようかんのホームページ', href: 'https://youkan.uk/' },
        ]);
    });

    it('Mastodon のリンク（見えない span で切った URL）は URL 全体を文字にする', () => {
        const html =
            '<p>site: <a href="https://example.com/very/long/path" rel="nofollow noopener" target="_blank">' +
            '<span class="invisible">https://</span><span class="ellipsis">example.com/very/lo</span>' +
            '<span class="invisible">ng/path</span></a></p>';
        expect(htmlToRichText(html, 1500)).toEqual([
            { kind: 'text', text: 'site: ' },
            { kind: 'link', text: 'https://example.com/very/long/path', href: 'https://example.com/very/long/path' },
        ]);
    });

    it('メンションはアカウントを読む（ドメインが無ければ行き先のホスト。ID は小文字にする）', () => {
        const html =
            '<p><span class="h-card"><a href="https://mstdn.example/@Alice" class="u-url mention">@<span>Alice</span></a></span> と ' +
            '<a href="https://mi.example/@bob" class="u-url mention">@bob@other.example</a></p>';
        expect(htmlToRichText(html, 1500)).toEqual([
            { kind: 'mention', text: '@Alice', href: 'https://mstdn.example/@Alice', account: 'alice@mstdn.example' },
            { kind: 'text', text: ' と ' },
            {
                kind: 'mention',
                text: '@bob@other.example',
                href: 'https://mi.example/@bob',
                account: 'bob@other.example',
            },
        ]);
    });

    it('このサーバーの ID の形に合わないメンションは、アカウントを null にしてリンクとして残す', () => {
        const [mention] = htmlToRichText('<a href="https://x.example/@a">@a</a>', 1500);
        expect(mention).toEqual({ kind: 'mention', text: '@a', href: 'https://x.example/@a', account: null });
    });

    it('http(s) でないリンク・資格情報付きのリンクは文字だけにする。属性の実体参照は戻す', () => {
        expect(
            htmlToRichText(
                '<a href="javascript:alert(1)">押して</a><a href=\'https://u:p@x.example/\'>秘密</a>' +
                    '<a href="https://x.example/?a=1&amp;b=2">q</a>',
                1500,
            ),
        ).toEqual([
            { kind: 'text', text: '押して秘密' },
            { kind: 'link', text: 'q', href: 'https://x.example/?a=1&b=2' },
        ]);
    });

    it('元の文字に印の文字（私用領域）があっても区切りを偽造できない', () => {
        const segments = htmlToRichText('a0b<a href="https://x.example/">x</a>', 1500);
        expect(segments).toEqual([
            { kind: 'text', text: 'a0b' },
            { kind: 'link', text: 'x', href: 'https://x.example/' },
        ]);
    });

    it('文字の無いリンクは捨て、ほかのタグは除く。空・null は空の並び', () => {
        expect(htmlToRichText('<a href="https://x.example/"><img src="x"></a><b>太字</b>', 1500)).toEqual([
            { kind: 'text', text: '太字' },
        ]);
        expect(htmlToRichText(null, 1500)).toEqual([]);
        expect(htmlToRichText('', 1500)).toEqual([]);
    });

    it('合わせて max 文字まで（リンクの途中で切れたら、そのリンクの文字を切る）', () => {
        const segments = htmlToRichText('12345<a href="https://x.example/">abcdef</a>tail', 8);
        expect(segments).toEqual([
            { kind: 'text', text: '12345' },
            { kind: 'link', text: 'abc', href: 'https://x.example/' },
        ]);
        expect(richTextPlain(segments)).toHaveLength(8);
    });
});

describe('readCustomEmojis', () => {
    const emoji = (name: string, url: string) => ({ type: 'Emoji', name, icon: { type: 'Image', url } });

    it('`:name:` の名前と画像の URL を読む。名前の形が違う・http(s) でない画像・同じ名前の 2 つ目は捨てる', () => {
        expect(
            readCustomEmojis([
                emoji(':vrchat:', 'https://s3.example/a.png'),
                emoji(':bad name:', 'https://s3.example/b.png'),
                emoji(':x:', 'javascript:alert(1)'),
                emoji(':vrchat:', 'https://s3.example/other.png'),
                { type: 'Hashtag', name: '#tag', href: 'https://x.example/tags/tag' },
                { type: 'Emoji', name: ':s:', icon: 'https://s3.example/s.png' },
            ]),
        ).toEqual([
            { name: 'vrchat', url: 'https://s3.example/a.png' },
            { name: 's', url: 'https://s3.example/s.png' },
        ]);
    });

    it(`1 つだけ（配列でない）・無いものも読める。${MAX_CUSTOM_EMOJIS} 個まで`, () => {
        expect(readCustomEmojis(emoji(':a:', 'https://x.example/a.png'))).toHaveLength(1);
        expect(readCustomEmojis(undefined)).toEqual([]);
        const many = Array.from({ length: MAX_CUSTOM_EMOJIS + 5 }, (_, i) =>
            emoji(`:e${i}:`, 'https://x.example/e.png'),
        );
        expect(readCustomEmojis(many)).toHaveLength(MAX_CUSTOM_EMOJIS);
    });
});

describe('splitCustomEmojis', () => {
    const emojis = [
        { name: 'pple', url: 'https://x.example/pple.webp' },
        { name: 'b', url: 'https://x.example/b.png' },
    ];

    it('知っている `:name:` だけ絵文字にし、知らないものは文字のまま', () => {
        expect(splitCustomEmojis('ようかん :pple: と :unknown:', emojis)).toEqual([
            { kind: 'text', text: 'ようかん ' },
            { kind: 'emoji', name: 'pple', url: 'https://x.example/pple.webp' },
            { kind: 'text', text: ' と :unknown:' },
        ]);
    });

    it('閉じる「:」が次の開きになるものも読む（`:pple::b:`・`12:b:`）', () => {
        expect(splitCustomEmojis(':pple::b:', emojis).map((p) => p.kind)).toEqual(['emoji', 'emoji']);
        expect(splitCustomEmojis('12:b:', emojis)).toEqual([
            { kind: 'text', text: '12' },
            { kind: 'emoji', name: 'b', url: 'https://x.example/b.png' },
        ]);
    });

    it('Object の名前（constructor など）を絵文字と取り違えない。絵文字が無ければ文字 1 つ', () => {
        expect(splitCustomEmojis(':constructor:', emojis)).toEqual([{ kind: 'text', text: ':constructor:' }]);
        expect(splitCustomEmojis(':pple:', undefined)).toEqual([{ kind: 'text', text: ':pple:' }]);
        expect(splitCustomEmojis('', emojis)).toEqual([]);
    });
});

describe('保存したものを確かめ直す', () => {
    it('壊れた区切りは飛ばし、http(s) でないリンクは文字にし、合わせて max 文字まで', () => {
        expect(
            storedRichTextOf(
                [
                    { kind: 'text', text: 'abc' },
                    { kind: 'link', text: 'evil', href: 'javascript:alert(1)' },
                    { kind: 'mention', text: '@a', href: 'https://x.example/@a', account: 'a@x.example' },
                    { kind: 'script', text: 'x' },
                    { kind: 'text' },
                    'string',
                ],
                6,
            ),
        ).toEqual([
            { kind: 'text', text: 'abc' },
            { kind: 'text', text: 'evi' },
        ]);
        expect(storedRichTextOf(undefined, 10)).toBeNull();
        expect(storedRichTextOf({ kind: 'text' }, 10)).toBeNull();
    });

    it('保存した絵文字も名前の形と URL を確かめる', () => {
        expect(
            storedCustomEmojisOf([
                { name: 'ok', url: 'https://x.example/a.png' },
                { name: 'a b', url: 'https://x.example/a.png' },
                { name: 'js', url: 'javascript:1' },
                { name: 'ok', url: 'https://x.example/b.png' },
            ]),
        ).toEqual([{ name: 'ok', url: 'https://x.example/a.png' }]);
        expect(storedCustomEmojisOf(null)).toEqual([]);
    });

    it('clipRichText は max が 0 なら空', () => {
        expect(clipRichText([{ kind: 'text', text: 'abc' }], 0)).toEqual([]);
    });
});
