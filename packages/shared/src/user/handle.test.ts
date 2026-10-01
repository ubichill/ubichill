import { describe, expect, it } from 'vitest';
import {
    DisplayNameSchema,
    displayAuthorAccount,
    displayNameKey,
    formatAuthorAccount,
    HandleSchema,
    parseAuthorAccount,
} from './handle';

describe('HandleSchema', () => {
    it('英小文字・数字・_ の 3〜30 文字だけ許す', () => {
        for (const ok of ['hanako', 'abc', 'a_1', 'x'.repeat(30)])
            expect(HandleSchema.safeParse(ok).success).toBe(true);
        for (const ng of ['ab', 'x'.repeat(31), 'Hanako', 'よーかん', 'you-kan', 'you.kan', 'you kan', ''])
            expect(HandleSchema.safeParse(ng).success).toBe(false);
    });

    it('予約語は取れない', () => {
        expect(HandleSchema.safeParse('admin').success).toBe(false);
        expect(HandleSchema.safeParse('ubichill').success).toBe(false);
    });
});

describe('parseAuthorAccount', () => {
    it('handle@domain を分解し、@ / acct: の前置きを許す', () => {
        const expected = { handle: 'hanako', domain: 'ubichill.com' };
        expect(parseAuthorAccount('hanako@ubichill.com')).toEqual(expected);
        expect(parseAuthorAccount('@hanako@ubichill.com')).toEqual(expected);
        expect(parseAuthorAccount('acct:hanako@ubichill.com')).toEqual(expected);
    });

    it('ドメインは小文字化し、開発用のポートを許す', () => {
        expect(parseAuthorAccount('hanako@UbiChill.com')).toEqual({ handle: 'hanako', domain: 'ubichill.com' });
        expect(parseAuthorAccount('hanako@localhost:3001')).toEqual({ handle: 'hanako', domain: 'localhost:3001' });
    });

    it('handle の大文字・パス・余計な @ は拒否（URL 注入や曖昧さを防ぐ）', () => {
        for (const ng of [
            'Hanako@ubichill.com',
            'hanako@ubichill.com/path',
            'hanako@',
            '@ubichill.com',
            'a@b@c',
            'hanako@evil.com?x=1',
        ])
            expect(parseAuthorAccount(ng)).toBeNull();
    });

    it('format と display', () => {
        expect(formatAuthorAccount({ handle: 'hanako', domain: 'UBICHILL.com' })).toBe('hanako@ubichill.com');
        expect(displayAuthorAccount('hanako@ubichill.com')).toBe('@hanako@ubichill.com');
    });
});

describe('displayNameKey（表示名の一意性）', () => {
    it('全角半角・大文字小文字・前後と連続の空白の違いは同じ名前', () => {
        const key = displayNameKey('Hanako Dev');
        for (const same of ['hanako dev', 'ＨＡＮＡＫＯ　Ｄｅｖ', '  hanako   dev ', 'HANAKO DEV']) {
            expect(displayNameKey(same)).toBe(key);
        }
    });

    it('ひらがなとカタカナ、別の文字は別の名前', () => {
        expect(displayNameKey('はなこ')).not.toBe(displayNameKey('ハナコ'));
        expect(displayNameKey('はなこ')).not.toBe(displayNameKey('はなこ2'));
    });

    it('半角カナは全角カナと同じ（NFKC）', () => {
        expect(displayNameKey('ﾊﾅｺ')).toBe(displayNameKey('ハナコ'));
    });
});

describe('DisplayNameSchema', () => {
    it('日本語・記号は使えるが、空・長すぎ・制御文字は不可', () => {
        expect(DisplayNameSchema.safeParse('はなこ🍡').success).toBe(true);
        expect(DisplayNameSchema.safeParse('   ').success).toBe(false);
        expect(DisplayNameSchema.safeParse('x'.repeat(31)).success).toBe(false);
        expect(DisplayNameSchema.safeParse('you\u0000kan').success).toBe(false);
    });
});
