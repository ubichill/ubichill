import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecretBox } from '../../../lib/secretBox';
import { serverKeysFrom } from '../../../lib/serverKeys';
import { type BotProtectionDeps, createBotProtection, type StoredBotProtection } from './botProtection';
import type { SiteVerifyInput, SiteVerifyResult } from './providers';

const HOST = 'ubichill.example';
const keys = serverKeysFrom('server-secret');

/** 偽の検証 API。トークンごとに結果を決める（`ok-<action>` は通る。`down` はつながらない） */
const verifyResult = (input: SiteVerifyInput): SiteVerifyResult => {
    const [kind, ...action] = input.token.split('-');
    const base = { hostname: HOST, action: action.join('-') || null, testing: false, errorCodes: [] };
    if (input.secret !== 'real-secret') return { ...base, success: false, errorCodes: ['invalid-input-secret'] };
    if (kind === 'ok') return { ...base, success: true };
    if (kind === 'elsewhere') return { ...base, success: true, hostname: 'evil.example' };
    if (kind === 'testing') return { ...base, success: true, hostname: 'example.com', testing: true };
    return { ...base, success: false, errorCodes: ['invalid-input-response'] };
};

function setup(overrides: Partial<BotProtectionDeps> = {}) {
    const store: { row: StoredBotProtection | null } = { row: null };
    const calls = { changed: 0, verify: [] as Array<{ provider: string; input: SiteVerifyInput }> };
    const warn = vi.fn();
    const deps: BotProtectionDeps = {
        cached: async () => store.row,
        repository: {
            get: async () => store.row,
            put: async (input) => {
                store.row = { ...input, updatedAt: new Date('2026-11-21T00:00:00Z') };
            },
            clear: async () => {
                store.row = null;
            },
        },
        box: createSecretBox(keys, 'bot-protection/secret'),
        siteVerify: async (provider, input) => {
            calls.verify.push({ provider, input });
            if (input.token.startsWith('down')) throw new Error('timeout');
            return verifyResult(input);
        },
        hostnames: new Set([HOST]),
        allowTestingKeys: false,
        changed: () => {
            calls.changed++;
        },
        warn,
        ...overrides,
    };
    return { bot: createBotProtection(deps), store, calls, warn };
}

const enable = (provider: 'turnstile' | 'hcaptcha' = 'turnstile', extra: Record<string, unknown> = {}) => ({
    provider,
    siteKey: 'site-key',
    secret: 'real-secret',
    token: 'ok-bot-protection-settings',
    ...extra,
});

describe('ボット対策の確認（check）', () => {
    it('使っていなければ、トークンが無くても検証 API を呼ばずに通す', async () => {
        const { bot, calls } = setup();
        expect(await bot.config()).toBeNull();
        expect(await bot.check({ token: undefined, action: 'sign-up', remoteIp: '1.2.3.4' })).toEqual({ ok: true });
        expect(calls.verify).toHaveLength(0);
    });

    it('使っているなら、トークンが無い・空白だけでは検証 API を呼ばずに断る', async () => {
        const { bot, calls } = setup();
        await bot.update(enable());
        calls.verify.length = 0;
        for (const token of [undefined, '', '   ']) {
            expect(await bot.check({ token, action: 'sign-up', remoteIp: undefined })).toEqual({
                ok: false,
                status: 400,
                code: 'bot-check-required',
            });
        }
        expect(calls.verify).toHaveLength(0);
    });

    it('通ったトークンは通す。保存したシークレットキー・サイトキー・IP で問い合わせる', async () => {
        const { bot, calls } = setup();
        await bot.update(enable('hcaptcha'));
        expect(await bot.config()).toEqual({ provider: 'hcaptcha', siteKey: 'site-key' });
        expect(await bot.check({ token: 'ok', action: 'sign-up', remoteIp: '1.2.3.4' })).toEqual({ ok: true });
        expect(calls.verify.at(-1)).toEqual({
            provider: 'hcaptcha',
            input: { secret: 'real-secret', token: 'ok', siteKey: 'site-key', remoteIp: '1.2.3.4' },
        });
    });

    it('別の画面のトークン（action 違い）・ほかのサイトのトークン・通らないトークン・長すぎるトークンは 400', async () => {
        const { bot, warn } = setup();
        await bot.update(enable());
        const failed = { ok: false, status: 400, code: 'bot-check-failed' };
        expect(
            await bot.check({ token: 'ok-bot-protection-settings', action: 'sign-up', remoteIp: undefined }),
        ).toEqual(failed);
        expect(await bot.check({ token: 'elsewhere-sign-up', action: 'sign-up', remoteIp: undefined })).toEqual(failed);
        expect(await bot.check({ token: 'bad-sign-up', action: 'sign-up', remoteIp: undefined })).toEqual(failed);
        expect(await bot.check({ token: `ok-${'x'.repeat(9000)}`, action: 'sign-up', remoteIp: undefined })).toEqual(
            failed,
        );
        // ホスト名が違うのは、公開 URL の設定の誤りかもしれないので残す
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('evil.example'));
    });

    it('検証 API につながらなければ、通さずにやり直せるエラー（503）。理由はログに残す', async () => {
        const { bot, warn } = setup();
        await bot.update(enable());
        expect(await bot.check({ token: 'down', action: 'sign-up', remoteIp: undefined })).toEqual({
            ok: false,
            status: 503,
            code: 'bot-check-unavailable',
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    });

    it('シークレットキーを開けない（サーバーの秘密を入れ替えた）・鍵を無効にされたときは、登録を止めて残す', async () => {
        const { bot, store, warn } = setup();
        await bot.update(enable());
        const sealed = store.row?.secret ?? '';
        // サイトキーだけ書き換えられた行は開けない（シークレットキーはサイトキーと組で封じている）
        store.row = { ...(store.row as StoredBotProtection), siteKey: 'other-site' };
        const misconfigured = { ok: false, status: 503, code: 'bot-check-misconfigured' };
        expect(await bot.check({ token: 'ok-sign-up', action: 'sign-up', remoteIp: undefined })).toEqual(misconfigured);
        expect((await bot.settings()).secretReadable).toBe(false);

        // 管理者が検証サービスの側で鍵を消した
        store.row = {
            ...(store.row as StoredBotProtection),
            siteKey: 'site-key',
            secret: createSecretBox(keys, 'bot-protection/secret').seal(
                new TextEncoder().encode('revoked-secret'),
                'bot-protection\nturnstile\nsite-key',
            ),
        };
        expect(sealed).not.toBe(store.row.secret);
        expect(await bot.check({ token: 'ok-sign-up', action: 'sign-up', remoteIp: undefined })).toEqual(misconfigured);
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('知らないサービスが保存されていたら（版を戻したなど）、画面には出さず登録を止める', async () => {
        const { bot, store } = setup();
        store.row = { provider: 'recaptcha', siteKey: 's', secret: 'x', updatedAt: new Date() };
        expect(await bot.config()).toBeNull();
        expect(await bot.check({ token: 'ok-sign-up', action: 'sign-up', remoteIp: undefined })).toMatchObject({
            code: 'bot-check-misconfigured',
        });
        expect(await bot.settings()).toMatchObject({ config: null, secretReadable: false });
    });
});

describe('ボット対策の設定（update）', () => {
    it('その鍵の組で確かめて通ったら保存する。シークレットキーは暗号化し、画面には返さない', async () => {
        const { bot, store, calls } = setup();
        const outcome = await bot.update(enable());
        expect(outcome).toEqual({
            ok: true,
            value: {
                config: { provider: 'turnstile', siteKey: 'site-key' },
                secretReadable: true,
                updatedAt: '2026-11-21T00:00:00.000Z',
            },
        });
        expect(store.row?.secret).not.toContain('real-secret');
        expect(JSON.stringify(outcome)).not.toContain('real-secret');
        expect(calls.changed).toBe(1);
        // 確かめるときは IP を送らない（管理者の操作）
        expect(calls.verify[0]?.input.remoteIp).toBeUndefined();
    });

    it('確かめて通らなければ保存しない（誤った鍵で登録を全部止めない）', async () => {
        const { bot, store, calls } = setup();
        const cases: Array<[Record<string, unknown>, number, string]> = [
            [{ secret: 'wrong-secret' }, 400, 'シークレットキーが正しくないか'],
            [{ token: 'bad' }, 400, '確認が通りませんでした'],
            [{ token: 'ok-sign-up' }, 400, '確認が通りませんでした'],
            [{ token: 'down' }, 503, '接続できませんでした'],
            [{ token: 'elsewhere-bot-protection-settings' }, 400, 'ホスト名（evil.example）'],
            [{ token: 'testing' }, 400, 'テスト用の鍵は本番では使えません'],
        ];
        for (const [extra, status, error] of cases) {
            const outcome = await bot.update(enable('turnstile', extra));
            expect(outcome).toMatchObject({ ok: false, status });
            expect(outcome.ok ? '' : outcome.error).toContain(error);
        }
        expect(store.row).toBeNull();
        expect(calls.changed).toBe(0);
    });

    it('本番以外では、テスト用の鍵で保存できる', async () => {
        const { bot } = setup({ allowTestingKeys: true });
        expect(await bot.update(enable('turnstile', { token: 'testing' }))).toMatchObject({ ok: true });
    });

    it('入力の誤りは理由を返す（サービス・サイトキー・シークレットキー・確認）', async () => {
        const { bot, calls } = setup();
        const error = async (input: unknown) => {
            const outcome = await bot.update(input);
            return outcome.ok ? null : outcome.error;
        };
        expect(await error({ provider: 'recaptcha', siteKey: 's', token: 't' })).toBe(
            'ボット対策のサービスが正しくありません',
        );
        expect(await error(null)).toBe('ボット対策のサービスが正しくありません');
        expect(await error(enable('turnstile', { siteKey: 'has space' }))).toBe('サイトキーが正しくありません');
        expect(await error(enable('turnstile', { siteKey: '' }))).toBe('サイトキーが正しくありません');
        expect(await error(enable('turnstile', { secret: 'x'.repeat(201) }))).toBe(
            'シークレットキーが正しくありません',
        );
        expect(await error(enable('turnstile', { token: '' }))).toBe('ボットでないことの確認を済ませてください');
        expect(calls.verify).toHaveLength(0);
    });

    it('シークレットキーを省くと、同じサービスのときだけ保存済みのものを使う', async () => {
        const { bot, calls } = setup();
        expect(await bot.update(enable('turnstile', { secret: undefined }))).toEqual({
            ok: false,
            status: 400,
            error: 'シークレットキーを入れてください',
        });
        await bot.update(enable('turnstile'));
        // サイトキーを変えても、同じサービスなら保存済みのシークレットキーで確かめる
        expect(await bot.update(enable('turnstile', { secret: undefined, siteKey: 'site-key-2' }))).toMatchObject({
            ok: true,
            value: { config: { siteKey: 'site-key-2' } },
        });
        expect(calls.verify.at(-1)?.input.secret).toBe('real-secret');
        expect(await bot.update(enable('hcaptcha', { secret: undefined }))).toMatchObject({
            ok: false,
            error: 'シークレットキーを入れてください',
        });
    });

    it('保存済みのシークレットキーを使い回すときは、覚えた古い設定ではなく DB の今のものを使う', async () => {
        const stale = { row: null as StoredBotProtection | null };
        const { bot, store, calls } = setup({ cached: async () => stale.row });
        await bot.update(enable('turnstile', { secret: 'real-secret' }));
        // ほかの backend の知らせが届かず、この backend は古い（開けない）シークレットキーを覚えている
        stale.row = { ...(store.row as StoredBotProtection), secret: 'stale' };
        expect(await bot.update(enable('turnstile', { secret: undefined, siteKey: 'site-key' }))).toMatchObject({
            ok: true,
        });
        expect(calls.verify.at(-1)?.input.secret).toBe('real-secret');
        expect((await bot.settings()).secretReadable).toBe(true);
    });

    it('使わないにすると鍵ごと消し、確認なしで登録を通す', async () => {
        const { bot, store, calls } = setup();
        await bot.update(enable());
        expect(await bot.update({ provider: null })).toEqual({
            ok: true,
            value: { config: null, secretReadable: true, updatedAt: null },
        });
        expect(store.row).toBeNull();
        expect(calls.changed).toBe(2);
        expect(await bot.check({ token: undefined, action: 'sign-up', remoteIp: undefined })).toEqual({ ok: true });
    });
});

beforeEach(() => {
    vi.restoreAllMocks();
});
