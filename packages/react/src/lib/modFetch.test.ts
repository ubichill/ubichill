import { UbiErrorCode } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalUrlAccess } from './externalUrlAuthorization';
import { createModFetch } from './modFetch';

const APP = 'https://ubichill.example';

/** 本体の /api は禁止、evil.example は未承認、それ以外の https は承認済みとする認可。 */
const authorizeUrl = vi.fn(async (url: string): Promise<ExternalUrlAccess> => {
    const parsed = new URL(url, APP);
    if (parsed.origin === APP && parsed.pathname.startsWith('/api/')) {
        return { allowed: false, code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED, message: 'core api' };
    }
    if (parsed.hostname === 'evil.example') {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
            message: 'not approved',
            domain: 'evil.example',
        };
    }
    return { allowed: true, url: parsed.href };
});

function ok(url: string, body: string | ArrayBuffer = 'secret') {
    return { ok: true, status: 200, statusText: 'OK', headers: {}, url, body };
}

function setup(fetchImpl: ReturnType<typeof vi.fn>) {
    authorizeUrl.mockClear();
    const report = vi.fn();
    const handler = createModFetch({
        modId: 'demo',
        appOrigin: APP,
        authorizeUrl,
        fetchImpl: fetchImpl as never,
        report,
    });
    return { handler, report };
}

describe('createModFetch', () => {
    it('外部オリジンには cookie を送らず、取り消し用の signal を渡す', async () => {
        const fetchImpl = vi.fn(async (url: string) => ok(url));
        const { handler } = setup(fetchImpl);
        const signal = new AbortController().signal;

        await handler('https://api.example.com/v1', { responseType: 'arrayBuffer' }, { signal });

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://api.example.com/v1',
            { responseType: 'arrayBuffer' },
            { signal, credentials: 'omit' },
        );
    });

    it('本体オリジン上の自分の領域は same-origin で取得する', async () => {
        const fetchImpl = vi.fn(async (url: string) => ok(url));
        const { handler } = setup(fetchImpl);
        await handler('/mods/demo/v1.0.0/data.bin');
        expect(fetchImpl).toHaveBeenCalledWith(`${APP}/mods/demo/v1.0.0/data.bin`, undefined, {
            signal: undefined,
            credentials: 'same-origin',
        });
    });

    it('拒否は通信せず 403 を返し、許可ボタン用のドメインを診断に載せる（arrayBuffer なら本文も ArrayBuffer）', async () => {
        const fetchImpl = vi.fn();
        const { handler, report } = setup(fetchImpl);

        const res = await handler('https://evil.example/x', { responseType: 'arrayBuffer' });

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: false, status: 403, error: { code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED } });
        expect(res.body).toBeInstanceOf(ArrayBuffer);
        expect(report).toHaveBeenCalledWith(
            expect.objectContaining({ retry: { modId: 'demo', domain: 'evil.example' } }),
        );
    });

    it('承認待ちの間に mod が取り消していたら通信しない', async () => {
        const fetchImpl = vi.fn();
        const { handler } = setup(fetchImpl);
        const controller = new AbortController();
        controller.abort();

        const res = await handler('https://api.example.com/v1', undefined, { signal: controller.signal });

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(res.error?.code).toBe(UbiErrorCode.FETCH_ABORTED);
    });

    it('承認待ちの間に取り消されたら、拒否として診断に出さず FETCH_ABORTED で返す', async () => {
        const fetchImpl = vi.fn();
        const report = vi.fn();
        const controller = new AbortController();
        const handler = createModFetch({
            modId: 'demo',
            appOrigin: APP,
            authorizeUrl: async () => {
                controller.abort();
                return { allowed: false, code: UbiErrorCode.FETCH_ABORTED, message: 'aborted' };
            },
            fetchImpl: fetchImpl as never,
            report,
        });

        const res = await handler('https://api.example.com/v1', undefined, { signal: controller.signal });

        expect(res.error?.code).toBe(UbiErrorCode.FETCH_ABORTED);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
    });

    it('取り消しの signal を承認待ちにも渡す（画面の取り下げに使う）', async () => {
        const { handler } = setup(vi.fn(async (url: string) => ok(url)));
        const signal = new AbortController().signal;
        await handler('https://api.example.com/v1', undefined, { signal });
        expect(authorizeUrl).toHaveBeenCalledWith('https://api.example.com/v1', signal);
    });

    it('認可は送信前の 1 回だけ（リダイレクトは Host の fetch が追わない）', async () => {
        const fetchImpl = vi.fn(async (url: string) => ok(url));
        const { handler } = setup(fetchImpl);
        await handler('https://api.example.com/v1');
        expect(authorizeUrl).toHaveBeenCalledTimes(1);
    });
});
