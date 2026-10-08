import { UbiErrorCode } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalUrlAccess } from './externalUrlAuthorization';
import { createModIdentity, IDENTITY_TOKEN_REUSE_MARGIN_MS } from './modIdentity';

const AUDIENCE = 'https://videoplayer.example';
const allow = async (url: string): Promise<ExternalUrlAccess> => ({ allowed: true, url });

function setup(overrides: Partial<Parameters<typeof createModIdentity>[0]> = {}) {
    const clock = { now: 1_000_000 };
    const requestToken = vi.fn(async ({ audience }: { audience: string }) => ({
        token: `token-for-${audience}-${requestToken.mock.calls.length}`,
        expiresAt: clock.now + 300_000,
    }));
    const report = vi.fn();
    const authorizeUrl = vi.fn(allow);
    const handler = createModIdentity({
        modId: 'video-player',
        authorizeUrl,
        requestToken,
        now: () => clock.now,
        report,
        ...overrides,
    });
    const signal = () => new AbortController().signal;
    return { handler, requestToken, report, authorizeUrl, clock, signal };
}

describe('createModIdentity', () => {
    it('宛先をオリジンに正規化し、fetch と同じ認可を通してから mod の ID 付きで依頼する', async () => {
        const { handler, requestToken, authorizeUrl } = setup();
        const signal = new AbortController().signal;

        const result = await handler(`${AUDIENCE}/`, { signal });

        expect(authorizeUrl).toHaveBeenCalledWith(`${AUDIENCE}/`, signal);
        expect(requestToken).toHaveBeenCalledWith({ audience: AUDIENCE, modId: 'video-player' });
        expect(result.token).toBe(`token-for-${AUDIENCE}-1`);
    });

    it('パス付き・http などサービスのオリジンでない宛先は、認可も依頼もせずに拒否する', async () => {
        const { handler, requestToken, authorizeUrl, signal } = setup();
        for (const bad of [`${AUDIENCE}/api`, 'http://videoplayer.example', 'not a url']) {
            await expect(handler(bad, { signal: signal() })).rejects.toMatchObject({
                code: UbiErrorCode.IDENTITY_AUDIENCE_INVALID,
            });
        }
        expect(authorizeUrl).not.toHaveBeenCalled();
        expect(requestToken).not.toHaveBeenCalled();
    });

    it('ユーザーが通信を許していないドメインには証明を出さず、許可ボタン付きで診断に出す', async () => {
        const { handler, requestToken, report, signal } = setup({
            authorizeUrl: async () => ({
                allowed: false,
                code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
                message: 'not approved',
                domain: 'videoplayer.example',
            }),
        });
        await expect(handler(AUDIENCE, { signal: signal() })).rejects.toMatchObject({
            code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
        });
        expect(requestToken).not.toHaveBeenCalled();
        expect(report).toHaveBeenCalledWith(
            expect.objectContaining({ retry: { modId: 'video-player', domain: 'videoplayer.example' } }),
        );
    });

    it('承認待ちの間に取り消されたら FETCH_ABORTED。拒否の診断は出さない', async () => {
        const controller = new AbortController();
        const { handler, requestToken, report } = setup({
            authorizeUrl: async () => {
                controller.abort();
                return { allowed: false, code: UbiErrorCode.FETCH_ABORTED, message: 'aborted' };
            },
        });
        await expect(handler(AUDIENCE, { signal: controller.signal })).rejects.toMatchObject({
            code: UbiErrorCode.FETCH_ABORTED,
        });
        expect(requestToken).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
    });

    it('Provider が無い画面では IDENTITY_UNAVAILABLE', async () => {
        const { handler, signal } = setup({ requestToken: null });
        await expect(handler(AUDIENCE, { signal: signal() })).rejects.toMatchObject({
            code: UbiErrorCode.IDENTITY_UNAVAILABLE,
        });
    });

    it('期限まで余裕のあるトークンは使い回し、期限が近づいたら取り直す', async () => {
        const { handler, requestToken, clock, signal } = setup();
        const first = await handler(AUDIENCE, { signal: signal() });

        clock.now += 300_000 - IDENTITY_TOKEN_REUSE_MARGIN_MS - 1;
        expect(await handler(AUDIENCE, { signal: signal() })).toBe(first);
        expect(requestToken).toHaveBeenCalledTimes(1);

        clock.now += 2;
        const second = await handler(AUDIENCE, { signal: signal() });
        expect(second).not.toBe(first);
        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('宛先ごとに別のトークン（他のサービス用を使い回さない）', async () => {
        const { handler, requestToken, signal } = setup();
        await handler(AUDIENCE, { signal: signal() });
        await handler('https://other.example', { signal: signal() });
        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('同時の依頼は 1 回にまとめる', async () => {
        const { handler, requestToken, signal } = setup();
        const [a, b] = await Promise.all([
            handler(AUDIENCE, { signal: signal() }),
            handler(AUDIENCE, { signal: signal() }),
        ]);
        expect(a).toBe(b);
        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('発行に失敗したらキャッシュせず、次の呼び出しで取り直す', async () => {
        const requestToken = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error('down'), { code: UbiErrorCode.IDENTITY_UNAVAILABLE }))
            .mockResolvedValueOnce({ token: 't', expiresAt: Date.now() + 300_000 });
        const { handler, signal } = setup({ requestToken, now: Date.now });
        await expect(handler(AUDIENCE, { signal: signal() })).rejects.toThrow('down');
        await expect(handler(AUDIENCE, { signal: signal() })).resolves.toMatchObject({ token: 't' });
    });
});
