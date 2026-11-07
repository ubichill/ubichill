import { describe, expect, it } from 'vitest';
import {
    bearerToken,
    exchangeOutcome,
    loopbackRedirect,
    newApiToken,
    newUserCode,
    requestFlowOf,
    type StoredRequest,
    sha256Base64Url,
} from './cliAuth';

const NOW = new Date('2026-10-02T00:00:00Z');
const later = new Date(NOW.getTime() + 60_000);
const base = { kind: 'cli' as const, name: 'CLI', publicKey: 'A'.repeat(43) };

describe('requestFlowOf', () => {
    it('リダイレクト先と PKCE が無ければデバイス認可、組であればループバック', () => {
        expect(requestFlowOf(base)).toBe('device');
        expect(requestFlowOf({ ...base, redirectUri: 'http://127.0.0.1:5000/cb', codeChallenge: 'C'.repeat(43) })).toBe(
            'loopback',
        );
    });

    it('片方だけ・ループバック以外のリダイレクト先は拒否する', () => {
        expect(requestFlowOf({ ...base, redirectUri: 'http://127.0.0.1:5000/cb' })).toHaveProperty('error');
        expect(requestFlowOf({ ...base, codeChallenge: 'C'.repeat(43) })).toHaveProperty('error');
        expect(
            requestFlowOf({ ...base, redirectUri: 'https://evil.example/cb', codeChallenge: 'C'.repeat(43) }),
        ).toHaveProperty('error');
    });
});

describe('exchangeOutcome', () => {
    const verifier = 'verifier-'.padEnd(50, 'x');
    const loopback: StoredRequest = {
        status: 'approved',
        expiresAt: later,
        codeChallenge: sha256Base64Url(verifier),
        authCodeHash: sha256Base64Url('the-code'),
        deviceCodeHash: null,
    };
    const device: StoredRequest = {
        status: 'pending',
        expiresAt: later,
        codeChallenge: null,
        authCodeHash: null,
        deviceCodeHash: sha256Base64Url('device-code'),
    };

    it('ループバックは認可コードと PKCE の両方が一致したときだけ引き換えられる', () => {
        expect(exchangeOutcome(loopback, { code: 'the-code', codeVerifier: verifier }, NOW)).toEqual({ ok: true });
        // 認可コードを横取りしても、PKCE の verifier を知らなければ引き換えられない
        expect(exchangeOutcome(loopback, { code: 'the-code', codeVerifier: 'guess' }, NOW)).toMatchObject({
            ok: false,
            code: 'invalid-grant',
        });
        expect(exchangeOutcome(loopback, { code: 'other', codeVerifier: verifier }, NOW)).toMatchObject({ ok: false });
    });

    it('デバイス認可は、承認されるまで 428（ポーリングで待つ）、承認後に引き換えられる', () => {
        expect(exchangeOutcome(device, { deviceCode: 'device-code' }, NOW)).toMatchObject({
            ok: false,
            status: 428,
            code: 'authorization-pending',
        });
        expect(exchangeOutcome({ ...device, status: 'approved' }, { deviceCode: 'device-code' }, NOW)).toEqual({
            ok: true,
        });
    });

    it('デバイスコードが違えば、承認待ちかどうかも教えない', () => {
        expect(exchangeOutcome(device, { deviceCode: 'wrong' }, NOW)).toMatchObject({ code: 'invalid-grant' });
    });

    it('失効・存在しない要求は 404、引き換え済みは 409（2 回目の引き換えは通らない）', () => {
        expect(exchangeOutcome(undefined, { deviceCode: 'x' }, NOW)).toMatchObject({ status: 404 });
        expect(exchangeOutcome({ ...device, expiresAt: NOW }, { deviceCode: 'device-code' }, NOW)).toMatchObject({
            status: 404,
        });
        expect(
            exchangeOutcome({ ...loopback, status: 'consumed' }, { code: 'the-code', codeVerifier: verifier }, NOW),
        ).toMatchObject({ status: 409 });
    });

    it('承認されていないループバックの要求は引き換えられない', () => {
        expect(
            exchangeOutcome({ ...loopback, status: 'pending' }, { code: 'the-code', codeVerifier: verifier }, NOW),
        ).toMatchObject({ ok: false, code: 'invalid-grant' });
    });
});

describe('newUserCode / newApiToken / bearerToken', () => {
    it('user code は XXXX-XXXX で、紛らわしい文字を使わない', () => {
        const seq = [0, 1, 2, 3, 19, 18, 17, 16];
        const code = newUserCode(() => seq.shift() ?? 0);
        expect(code).toBe('BCDF-ZXWV');
        expect(newUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    });

    it('トークンは ubi_ 付きで毎回違い、Authorization ヘッダーから取り出せる', () => {
        const token = newApiToken();
        expect(token).toMatch(/^ubi_[A-Za-z0-9_-]{43}$/);
        expect(newApiToken()).not.toBe(token);
        expect(bearerToken(`Bearer ${token}`)).toBe(token);
        expect(bearerToken(`bearer ${token}`)).toBe(token);
        expect(bearerToken('Bearer something-else')).toBeUndefined();
        expect(bearerToken(undefined)).toBeUndefined();
    });
});

describe('loopbackRedirect', () => {
    it('認可コードと state を付ける（既存のクエリは残す）', () => {
        expect(loopbackRedirect('http://127.0.0.1:5000/cb?x=1', 'c0de', 'st')).toBe(
            'http://127.0.0.1:5000/cb?x=1&code=c0de&state=st',
        );
    });
});
