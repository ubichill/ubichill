import { createHash } from 'node:crypto';
import { cliAuthProofMessage, type WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { type AuthorizeDeps, authorize, type HttpResponse } from './authorize.ts';

const sha256 = (v: string) => createHash('sha256').update(v).digest('base64url');
const key: WorldSigningKey = { publicKey: 'P'.repeat(43), sign: async (m) => `signed(${m})` };
const tokenResponse: HttpResponse = {
    status: 200,
    body: { token: 'ubi_t', account: 'youkan@ubichill.com', environment: { id: 'env-1' } },
};

function fakeDeps(script: (url: string, body: Record<string, unknown>, calls: number) => HttpResponse) {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const opened: string[] = [];
    const clock = { t: 0 };
    const callback = { code: 'the-code', state: 'state-1' };
    const randoms = ['verifier-1', 'state-1'];
    const deps: AuthorizeDeps = {
        post: async (url, body) => {
            posts.push({ url, body: body as Record<string, unknown> });
            return script(url, body as Record<string, unknown>, posts.length);
        },
        generateKey: async () => ({ pkcs8: 'PKCS8', key }),
        openBrowser: async (url) => {
            opened.push(url);
            return true;
        },
        startLoopback: async () => ({
            redirectUri: 'http://127.0.0.1:5000/callback',
            waitForCallback: async () => callback,
            close: () => undefined,
        }),
        sleep: async (ms) => {
            clock.t += ms;
        },
        now: () => clock.t,
        log: () => undefined,
        random: () => randoms.shift() ?? 'x',
    };
    return { deps, posts, opened, callback };
}

const options = { server: 'https://ubichill.com', kind: 'cli' as const, name: 'CLI', flow: 'loopback' as const };

describe('authorize（ループバック）', () => {
    it('PKCE の challenge を送り、承認後に verifier と鍵の所有の証明で引き換える', async () => {
        const { deps, posts, opened } = fakeDeps((url) =>
            url.endsWith('/requests')
                ? { status: 201, body: { requestId: 'req-1', approveUrl: 'https://ubichill.com/cli/authorize?request=req-1' } }
                : tokenResponse,
        );
        const credential = await authorize(deps, options);
        expect(credential).toEqual({
            server: 'https://ubichill.com',
            account: 'youkan@ubichill.com',
            token: 'ubi_t',
            key: 'PKCS8',
            environmentId: 'env-1',
        });
        expect(posts[0]?.body).toMatchObject({
            kind: 'cli',
            publicKey: key.publicKey,
            redirectUri: 'http://127.0.0.1:5000/callback',
            codeChallenge: sha256('verifier-1'),
        });
        expect(opened[0]).toBe('https://ubichill.com/cli/authorize?request=req-1&state=state-1');
        expect(posts[1]?.body).toEqual({
            requestId: 'req-1',
            code: 'the-code',
            codeVerifier: 'verifier-1',
            signature: `signed(${cliAuthProofMessage('req-1')})`,
        });
    });

    it('リダイレクトの state が違えば引き換えない（別の要求の承認を受け取らない）', async () => {
        const { deps, posts, callback } = fakeDeps(() => ({
            status: 201,
            body: { requestId: 'req-1', approveUrl: 'https://x/cli/authorize?request=req-1' },
        }));
        callback.state = 'forged';
        await expect(authorize(deps, options)).rejects.toThrow(/state/);
        expect(posts).toHaveLength(1);
    });

    it('サーバーのエラーはその文言で失敗する', async () => {
        const { deps } = fakeDeps(() => ({ status: 400, body: { error: 'redirectUri は … に限ります' } }));
        await expect(authorize(deps, options)).rejects.toThrow('redirectUri は … に限ります');
    });
});

describe('authorize（デバイス認可）', () => {
    const created: HttpResponse = {
        status: 201,
        body: {
            requestId: 'req-2',
            approveUrl: 'https://ubichill.com/cli/authorize?code=BCDF-GHJK',
            userCode: 'BCDF-GHJK',
            deviceCode: 'device-code',
            interval: 3,
            expiresIn: 30,
        },
    };

    it('承認されるまで間隔を空けてポーリングし、承認後に引き換える（リダイレクト先は送らない）', async () => {
        const { deps, posts } = fakeDeps((url, _body, n) =>
            url.endsWith('/requests') ? created : n < 4 ? { status: 428, body: { code: 'authorization-pending' } } : tokenResponse,
        );
        const credential = await authorize(deps, { ...options, flow: 'device' });
        expect(credential.token).toBe('ubi_t');
        expect(posts[0]?.body).not.toHaveProperty('redirectUri');
        expect(posts.slice(1).every((p) => p.body.deviceCode === 'device-code')).toBe(true);
        expect(posts).toHaveLength(4);
    });

    it('期限までに承認されなければ失敗する', async () => {
        const { deps } = fakeDeps((url) => (url.endsWith('/requests') ? created : { status: 428, body: {} }));
        await expect(authorize(deps, { ...options, flow: 'device' })).rejects.toThrow(/期限/);
    });
});
