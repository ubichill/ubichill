import { describe, expect, it } from 'vitest';
import { sanitizeHtmlAttr, sanitizeStyle, sanitizeSvgAttr, sanitizeUrl } from './sanitize';

describe('sanitizeUrl', () => {
    it('http(s)・data:image・相対 URL だけを通す', () => {
        expect(sanitizeUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
        expect(sanitizeUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(sanitizeUrl('icons/a.png')).toBe('icons/a.png');
    });

    it('スクリプトを実行できるスキームや、スキームを紛れ込ませた書き方は通さない', () => {
        for (const url of [
            'javascript:alert(1)',
            ' javascript:alert(1)',
            'JaVaScRiPt:alert(1)',
            'java\tscript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'vbscript:x',
            '//attacker.example/a.png',
            '\\\\attacker.example/a.png',
            '/\\attacker.example/a.png',
        ]) {
            expect(sanitizeUrl(url), url).toBeNull();
        }
    });
});

describe('sanitizeHtmlAttr', () => {
    it('イベント属性・style 文字列・知らない属性は通さない', () => {
        for (const key of ['onclick', 'onClick', 'onerror', 'style', 'srcdoc', 'formaction', 'action', 'target']) {
            expect(sanitizeHtmlAttr('div', key, 'x'), key).toBeNull();
        }
    });

    it('パスワード欄は描かせない（自動入力されたパスワードが mod に渡る）', () => {
        expect(sanitizeHtmlAttr('input', 'type', 'password')).toBeNull();
        expect(sanitizeHtmlAttr('input', 'type', ' PassWord ')).toBeNull();
        expect(sanitizeHtmlAttr('input', 'type', 'text')).toBe('text');
    });

    it('data-* と aria-* は通す', () => {
        expect(sanitizeHtmlAttr('div', 'data-id', '1')).toBe('1');
        expect(sanitizeHtmlAttr('div', 'aria-label', 'x')).toBe('x');
        expect(sanitizeHtmlAttr('div', 'data-x onclick', '1')).toBeNull();
    });
});

describe('sanitizeSvgAttr', () => {
    it('イベント属性は HTML と同じく通さない', () => {
        for (const key of ['onclick', 'onload', 'onmouseover', 'onbegin', 'style', 'xlink:href']) {
            expect(sanitizeSvgAttr(key, 'alert(1)'), key).toBeNull();
        }
    });

    it('<use> の参照先は同じ文書内（#id）だけ', () => {
        expect(sanitizeSvgAttr('href', '#icon')).toBe('#icon');
        expect(sanitizeSvgAttr('href', 'https://attacker.example/sprite.svg#icon')).toBeNull();
        expect(sanitizeSvgAttr('href', 'data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
        expect(sanitizeSvgAttr('href', 'javascript:alert(1)')).toBeNull();
    });

    it('塗りの url() は同じ文書内の参照だけ', () => {
        expect(sanitizeSvgAttr('fill', 'url(#grad)')).toBe('url(#grad)');
        expect(sanitizeSvgAttr('fill', "url('#grad')")).toBe("url('#grad')");
        expect(sanitizeSvgAttr('fill', 'url(https://attacker.example/x.svg#g)')).toBeNull();
        expect(sanitizeSvgAttr('fill', 'url(#a) url(https://attacker.example/)')).toBeNull();
        expect(sanitizeSvgAttr('clip-path', 'u\\72l(https://attacker.example/)')).toBeNull();
        expect(sanitizeSvgAttr('fill', '#ff0000')).toBe('#ff0000');
    });
});

describe('sanitizeStyle', () => {
    it('ふつうの宣言は通す', () => {
        expect(sanitizeStyle('color', 'red')).toBe('red');
        expect(sanitizeStyle('width', 'calc(100% - 4px)')).toBe('calc(100% - 4px)');
        expect(sanitizeStyle('--accent', '#fff')).toBe('#fff');
        expect(sanitizeStyle('transform', 'translate(1px, 2px) rotate(3deg)')).toBe('translate(1px, 2px) rotate(3deg)');
    });

    it('外部への取得を起こす値は通さない（ドメイン承認を通らない送信経路になる）', () => {
        for (const value of [
            'url(https://attacker.example/?leak=1)',
            'URL( "https://attacker.example/" )',
            'image-set("https://attacker.example/a.png" 1x)',
            '-webkit-image-set(url(a.png) 1x)',
            'cross-fade(url(a.png), url(b.png), 50%)',
            'u\\72l(https://attacker.example/)',
            'url(data:image/png;base64,AAAA)',
        ]) {
            expect(sanitizeStyle('background-image', value), value).toBeNull();
        }
    });

    it('宣言やブロックの外へ出る書き方は通さない', () => {
        expect(sanitizeStyle('color', 'red; background: url(x)')).toBeNull();
        expect(sanitizeStyle('color', 'red} * { color: blue')).toBeNull();
    });

    it('プロパティ名として読めないものは通さない', () => {
        expect(sanitizeStyle('color;background', 'red')).toBeNull();
        expect(sanitizeStyle('', 'red')).toBeNull();
    });
});
