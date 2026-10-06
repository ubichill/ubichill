import { describe, expect, it } from 'vitest';
import { bioSegments } from './bioLinks';

const links = (bio: string) => bioSegments(bio).flatMap((s) => (s.kind === 'link' ? [s.href] : []));

describe('bioSegments', () => {
    it('URL のない自己紹介はそのまま 1 つの文字', () => {
        expect(bioSegments('よろしく\nお願いします')).toEqual([{ kind: 'text', text: 'よろしく\nお願いします' }]);
        expect(bioSegments('')).toEqual([]);
    });

    it('文中の URL をリンクにし、前後の文字は残す', () => {
        expect(bioSegments('作品は https://example.com/works にあります')).toEqual([
            { kind: 'text', text: '作品は ' },
            { kind: 'link', text: 'https://example.com/works', href: 'https://example.com/works' },
            { kind: 'text', text: ' にあります' },
        ]);
    });

    it('日本語の句読点・かっこに続けて書いても巻き込まない', () => {
        expect(links('サイトはhttps://example.com。よろしく')).toEqual(['https://example.com/']);
        expect(links('（https://example.com/a）')).toEqual(['https://example.com/a']);
        expect(links('「https://example.com/b」')).toEqual(['https://example.com/b']);
    });

    it('末尾の半角の句読点と対応しない ")" は含めない。対応する "()" は残す', () => {
        expect(links('見てね https://example.com/x.')).toEqual(['https://example.com/x']);
        expect(links('(https://example.com/y)')).toEqual(['https://example.com/y']);
        expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    });

    it('http(s) 以外はリンクにしない（javascript: などを踏ませない）', () => {
        expect(links('javascript:alert(1) data:text/html,x ftp://example.com')).toEqual([]);
        expect(links('<a href="javascript:alert(1)">')).toEqual([]);
    });

    it('複数の URL と、URL だけの自己紹介', () => {
        expect(links('https://a.example https://b.example/p?q=1#h')).toEqual([
            'https://a.example/',
            'https://b.example/p?q=1#h',
        ]);
        expect(bioSegments('https://a.example')).toEqual([
            { kind: 'link', text: 'https://a.example', href: 'https://a.example/' },
        ]);
    });

    it('つなげ直すと元の自己紹介に戻る（文字を落とさない）', () => {
        const bio = 'x https://a.example/(1)) y、https://b.example。\nz';
        expect(
            bioSegments(bio)
                .map((s) => s.text)
                .join(''),
        ).toBe(bio);
    });
});
