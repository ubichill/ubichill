import { describe, expect, it } from 'vitest';
import { displayAuthorAccount, formatAuthorAccount, HandleSchema, parseAuthorAccount } from './handle';

describe('HandleSchema', () => {
    it('英小文字・数字・_ の 3〜30 文字だけ許す', () => {
        for (const ok of ['youkan', 'abc', 'a_1', 'x'.repeat(30)])
            expect(HandleSchema.safeParse(ok).success).toBe(true);
        for (const ng of ['ab', 'x'.repeat(31), 'Youkan', 'よーかん', 'you-kan', 'you.kan', 'you kan', ''])
            expect(HandleSchema.safeParse(ng).success).toBe(false);
    });

    it('予約語は取れない', () => {
        expect(HandleSchema.safeParse('admin').success).toBe(false);
        expect(HandleSchema.safeParse('ubichill').success).toBe(false);
    });
});

describe('parseAuthorAccount', () => {
    it('handle@domain を分解し、@ / acct: の前置きを許す', () => {
        const expected = { handle: 'youkan', domain: 'ubichill.com' };
        expect(parseAuthorAccount('youkan@ubichill.com')).toEqual(expected);
        expect(parseAuthorAccount('@youkan@ubichill.com')).toEqual(expected);
        expect(parseAuthorAccount('acct:youkan@ubichill.com')).toEqual(expected);
    });

    it('ドメインは小文字化し、開発用のポートを許す', () => {
        expect(parseAuthorAccount('youkan@UbiChill.com')).toEqual({ handle: 'youkan', domain: 'ubichill.com' });
        expect(parseAuthorAccount('youkan@localhost:3001')).toEqual({ handle: 'youkan', domain: 'localhost:3001' });
    });

    it('handle の大文字・パス・余計な @ は拒否（URL 注入や曖昧さを防ぐ）', () => {
        for (const ng of [
            'Youkan@ubichill.com',
            'youkan@ubichill.com/path',
            'youkan@',
            '@ubichill.com',
            'a@b@c',
            'youkan@evil.com?x=1',
        ])
            expect(parseAuthorAccount(ng)).toBeNull();
    });

    it('format と display', () => {
        expect(formatAuthorAccount({ handle: 'youkan', domain: 'UBICHILL.com' })).toBe('youkan@ubichill.com');
        expect(displayAuthorAccount('youkan@ubichill.com')).toBe('@youkan@ubichill.com');
    });
});
