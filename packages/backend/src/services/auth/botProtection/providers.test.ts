import { describe, expect, it } from 'vitest';
import {
    judgeSiteVerify,
    parseSiteVerify,
    publicHostnames,
    type SiteVerifyResult,
    siteVerifyRequest,
} from './providers';

const input = { secret: 'real-secret', token: 'tok', siteKey: 'site', remoteIp: '203.0.113.5' };
const expected = { action: 'sign-up', hostnames: new Set(['ubichill.example']), allowTestingKeys: false };
const passed = (overrides: Partial<SiteVerifyResult> = {}): SiteVerifyResult => ({
    success: true,
    hostname: 'ubichill.example',
    action: 'sign-up',
    testing: false,
    errorCodes: [],
    ...overrides,
});

describe('siteVerifyRequest', () => {
    it('Turnstile にはサイトキーを送らず、hCaptcha には送る。IP が無ければ remoteip を付けない', () => {
        const turnstile = siteVerifyRequest('turnstile', input);
        expect(turnstile.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
        expect(Object.fromEntries(turnstile.body)).toEqual({
            secret: 'real-secret',
            response: 'tok',
            remoteip: '203.0.113.5',
        });
        const hcaptcha = siteVerifyRequest('hcaptcha', { ...input, remoteIp: undefined });
        expect(hcaptcha.url).toBe('https://api.hcaptcha.com/siteverify');
        expect(Object.fromEntries(hcaptcha.body)).toEqual({ secret: 'real-secret', response: 'tok', sitekey: 'site' });
    });
});

describe('parseSiteVerify', () => {
    it('Turnstile の応答（テスト用の鍵の印を含む）を読む', () => {
        expect(
            parseSiteVerify(
                'turnstile',
                {
                    success: true,
                    hostname: 'example.com',
                    'error-codes': [],
                    metadata: { result_with_testing_key: true },
                },
                input,
            ),
        ).toEqual({ success: true, hostname: 'example.com', action: null, testing: true, errorCodes: [] });
        expect(
            parseSiteVerify(
                'turnstile',
                { success: true, hostname: 'ubichill.example', action: 'sign-up', 'error-codes': [] },
                input,
            ).testing,
        ).toBe(false);
    });

    it('hCaptcha はテスト用のシークレットキーかで見分ける', () => {
        const body = { success: true, hostname: 'dummy-key-pass', credit: false };
        expect(parseSiteVerify('hcaptcha', body, input).testing).toBe(false);
        expect(
            parseSiteVerify('hcaptcha', body, { ...input, secret: '0x0000000000000000000000000000000000000000' })
                .testing,
        ).toBe(true);
    });

    it('形の違う応答は失敗にする（success が文字列・本文が無い・error-codes が配列でない）', () => {
        expect(parseSiteVerify('turnstile', { success: 'true' }, input).success).toBe(false);
        expect(parseSiteVerify('turnstile', null, input)).toEqual({
            success: false,
            hostname: null,
            action: null,
            testing: false,
            errorCodes: [],
        });
        expect(parseSiteVerify('hcaptcha', { 'error-codes': 'bad', hostname: 3 }, input)).toMatchObject({
            errorCodes: [],
            hostname: null,
        });
    });
});

describe('judgeSiteVerify', () => {
    it('通った・ホスト名と action が合う（ホスト名の大文字小文字は問わない）', () => {
        expect(judgeSiteVerify('turnstile', passed(), expected)).toEqual({ ok: true });
        expect(judgeSiteVerify('turnstile', passed({ hostname: 'Ubichill.Example' }), expected)).toEqual({ ok: true });
    });

    it('ほかのサイトで取ったトークン（ホスト名が違う・無い）は通さない', () => {
        expect(judgeSiteVerify('turnstile', passed({ hostname: 'evil.example' }), expected)).toEqual({
            ok: false,
            reason: 'wrong-hostname',
            hostname: 'evil.example',
        });
        expect(judgeSiteVerify('hcaptcha', passed({ hostname: null }), expected)).toMatchObject({
            reason: 'wrong-hostname',
        });
    });

    it('Turnstile は別の画面で取ったトークン（action が違う・無い）を通さない。hCaptcha は action を返さないので見ない', () => {
        expect(judgeSiteVerify('turnstile', passed({ action: 'bot-protection-settings' }), expected)).toEqual({
            ok: false,
            reason: 'wrong-action',
        });
        expect(judgeSiteVerify('turnstile', passed({ action: null }), expected)).toMatchObject({
            reason: 'wrong-action',
        });
        expect(judgeSiteVerify('hcaptcha', passed({ action: null }), expected)).toEqual({ ok: true });
    });

    it('テスト用の鍵は本番では通さない。本番以外ではホスト名を照合せずに通す', () => {
        const testing = passed({ testing: true, hostname: 'example.com', action: null });
        expect(judgeSiteVerify('turnstile', testing, expected)).toEqual({ ok: false, reason: 'testing-key' });
        expect(judgeSiteVerify('turnstile', testing, { ...expected, allowTestingKeys: true })).toEqual({ ok: true });
        // テスト用の鍵でも、落ちる鍵は落とす
        expect(
            judgeSiteVerify('turnstile', { ...testing, success: false }, { ...expected, allowTestingKeys: true }),
        ).toEqual({ ok: false, reason: 'failed' });
    });

    it('鍵の誤りは「設定の問題」、検証サービスの不調は「つながらない」、使い回し・期限切れは「失敗」', () => {
        const failed = (codes: string[]) => passed({ success: false, errorCodes: codes });
        expect(judgeSiteVerify('turnstile', failed(['invalid-input-secret']), expected)).toEqual({
            ok: false,
            reason: 'misconfigured',
        });
        expect(judgeSiteVerify('hcaptcha', failed(['sitekey-secret-mismatch']), expected)).toMatchObject({
            reason: 'misconfigured',
        });
        expect(judgeSiteVerify('turnstile', failed(['internal-error']), expected)).toMatchObject({
            reason: 'unavailable',
        });
        expect(judgeSiteVerify('turnstile', failed(['timeout-or-duplicate']), expected)).toMatchObject({
            reason: 'failed',
        });
        expect(judgeSiteVerify('hcaptcha', failed(['already-seen-response']), expected)).toMatchObject({
            reason: 'failed',
        });
    });
});

describe('publicHostnames', () => {
    it('URL のホスト名だけを集め、`*` や URL でないものは除く', () => {
        expect([
            ...publicHostnames(['https://Ubichill.Example', 'https://ubichill.example:8443/x', '*', 'not a url']),
        ]).toEqual(['ubichill.example']);
    });
});
