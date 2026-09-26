import { SIGNING_KEY_WEBFINGER_PROPERTY } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { publicKeyFromWebFinger } from './authorKeys';

const KEY = 'A'.repeat(43);
const jrd = (subject: unknown, key: unknown = KEY) => ({
    subject,
    properties: { [SIGNING_KEY_WEBFINGER_PROPERTY]: key },
});

describe('publicKeyFromWebFinger', () => {
    it('問い合わせたアカウントの JRD から鍵を取り出す', () => {
        expect(publicKeyFromWebFinger(jrd('acct:youkan@ubichill.com'), 'youkan@ubichill.com')).toBe(KEY);
    });

    it('ドメインの大文字小文字は同一視する', () => {
        expect(publicKeyFromWebFinger(jrd('acct:youkan@UbiChill.com'), 'youkan@ubichill.com')).toBe(KEY);
    });

    it('別人の JRD（subject 不一致）は採用しない＝他人の鍵をすり替えられない', () => {
        expect(publicKeyFromWebFinger(jrd('acct:evil@ubichill.com'), 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger(jrd('acct:youkan@evil.com'), 'youkan@ubichill.com')).toBeUndefined();
    });

    it('subject・鍵が欠けている／形式不正なら undefined', () => {
        expect(publicKeyFromWebFinger(jrd(undefined), 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger(jrd('acct:youkan@ubichill.com', 'short'), 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger({ subject: 'acct:youkan@ubichill.com' }, 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger('not json', 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger(null, 'youkan@ubichill.com')).toBeUndefined();
    });
});
