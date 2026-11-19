import { createHash } from 'node:crypto';
import { cliAuthProofMessage, type WorldSigningKey } from '@ubichill/shared';
import { silentLogger } from '@ubichill/terminal';
import { describe, expect, it } from 'vitest';
import { type AuthorizeDeps, approveUrlOf, authorize, type HttpResponse } from './authorize.ts';

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
        log: silentLogger,
        random: () => randoms.shift() ?? 'x',
    };
    return { deps, posts, opened, callback };
}

const options = { server: 'https://ubichill.com', kind: 'cli' as const, name: 'CLI', flow: 'loopback' as const };

describe('authorize（ループバック）', () => {
    it('PKCE の challenge を送り、承認後に verifier と鍵の所有の証明で引き換える', async () => {
        const { deps, posts, opened } = fakeDeps((url) =>
            url.endsWith('/requests')
                ? {
                      status: 201,
                      body: { requestId: 'req-1', approveUrl: 'https://ubichill.com/cli/authorize?request=req-1' },
                  }
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
            body: { requestId: 'req-1', approveUrl: 'https://ubichill.com/cli/authorize?request=req-1' },
        }));
        callback.state = 'forged';
        await expect(authorize(deps, options)).rejects.toThrow(/state/);
        expect(posts).toHaveLength(1);
    });

    it('サーバーのエラーはその文言で失敗する', async () => {
        const { deps } = fakeDeps(() => ({ status: 400, body: { error: 'redirectUri は … に限ります' } }));
        await expect(authorize(deps, options)).rejects.toThrow('redirectUri は … に限ります');
    });

    it('承認画面の URL に & があっても、state は 1 つの値として付く', async () => {
        const { deps, opened } = fakeDeps((url) =>
            url.endsWith('/requests')
                ? { status: 201, body: { requestId: 'r', approveUrl: 'https://ubichill.com/cli/authorize?a=1&calc' } }
                : tokenResponse,
        );
        await authorize(deps, options);
        expect(new URL(opened[0] ?? '').searchParams.get('state')).toBe('state-1');
        expect(new URL(opened[0] ?? '').searchParams.get('a')).toBe('1');
    });

    it('ログイン先と別のオリジンの承認画面は開かず、承認を待たずに失敗する', async () => {
        const { deps, posts, opened } = fakeDeps(() => ({
            status: 201,
            body: { requestId: 'req-1', approveUrl: 'https://evil.example/cli/authorize?request=req-1' },
        }));
        await expect(authorize(deps, options)).rejects.toThrow('承認画面の URL');
        expect(opened).toEqual([]);
        expect(posts).toHaveLength(1);
    });
});

describe('approveUrlOf（ブラウザに渡す承認画面の URL）', () => {
    it.each([
        ['https://ubichill.com', 'https://ubichill.com/cli/authorize?request=1'],
        ['https://ubichill.com', 'https://UBICHILL.com:443/cli/authorize'],
        ['http://localhost:3001', 'http://localhost:5173/cli/authorize?request=1'],
        ['http://127.0.0.1:3001', 'http://localhost:5173/cli/authorize'],
        ['http://[::1]:3001', 'http://127.0.0.1:5173/cli/authorize'],
    ])('%s へのログインでは %s を開く', (server, approveUrl) => {
        expect(approveUrlOf(server, approveUrl).href).toBe(new URL(approveUrl).href);
    });

    it.each([
        ['別のサイト', 'https://evil.example/cli/authorize'],
        ['同じサイトの別のポート', 'https://ubichill.com:8443/cli/authorize'],
        ['http への格下げ', 'http://ubichill.com/cli/authorize'],
        ['userinfo で同じサイトに見せかける', 'https://ubichill.com@evil.example/cli/authorize'],
        ['サブドメイン', 'https://evil.ubichill.com/cli/authorize'],
        ['手元のポート（ログイン先は手元でない）', 'http://localhost:5173/cli/authorize'],
        ['javascript:', 'javascript:alert(1)'],
        ['file:', 'file:///C:/Windows/System32/calc.exe'],
        ['ほかのアプリのスキーム', 'ms-msdt:/id PCWDiagnostic'],
        ['相対パス', '/cli/authorize'],
        ['空', ''],
        ['文字列でない', undefined],
        ['数', 1],
    ])('%s（%j）は開かない', (_label, approveUrl) => {
        expect(() => approveUrlOf('https://ubichill.com', approveUrl)).toThrow('承認画面の URL');
    });

    it('ログイン先が手元でも、手元でない承認画面は開かない', () => {
        expect(() => approveUrlOf('http://localhost:3001', 'https://evil.example/cli/authorize')).toThrow(
            '承認画面の URL',
        );
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
            url.endsWith('/requests')
                ? created
                : n < 4
                  ? { status: 428, body: { code: 'authorization-pending' } }
                  : tokenResponse,
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
