import { createHash } from 'node:crypto';
import { DisplayNameSchema, HandleSchema, isPlaceholderEmail } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { nodeInfoDocumentUrl, readMastodonServer, readMisskeyServer } from './discovery';
import { HttpStatusError } from './protocol';
import { createFediverseSignIn, type ExternalIdentity, type FediverseSignInDeps, withQuery } from './signIn';

const MASTODON_METADATA = {
    issuer: 'https://mastodon.example/',
    authorization_endpoint: 'https://mastodon.example/oauth/authorize',
    token_endpoint: 'https://mastodon.example/oauth/token',
    revocation_endpoint: 'https://mastodon.example/oauth/revoke',
    scopes_supported: ['read', 'profile', 'read:accounts'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    app_registration_endpoint: 'https://mastodon.example/api/v1/apps',
};

const NODEINFO_WELL_KNOWN = (origin: string) => ({
    links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `${origin}/nodeinfo/2.1` }],
});
const misskeyNodeInfo = { version: '2.1', software: { name: 'misskey', version: '2026.11.0' } };

describe('サーバーの判定', () => {
    it('Mastodon は OAuth のメタデータ、Misskey 系は nodeinfo で見分ける', () => {
        expect(readMastodonServer('mastodon.example', MASTODON_METADATA)?.software).toBe('mastodon');
        expect(readMisskeyServer('mi.example', misskeyNodeInfo)?.software).toBe('misskey');
        expect(readMisskeyServer('mi.example', { software: { name: 'Sharkey' } })?.software).toBe('misskey');
        expect(readMisskeyServer('mi.example', { software: { name: 'pleroma' } })).toBeNull();
        expect(readMisskeyServer('mi.example', 'not json')).toBeNull();
    });

    it('エンドポイントが別のホストを指す Mastodon は使わない（資格情報を外へ送らせない）', () => {
        for (const key of ['authorization_endpoint', 'token_endpoint', 'app_registration_endpoint'] as const) {
            expect(
                readMastodonServer('mastodon.example', { ...MASTODON_METADATA, [key]: 'https://evil.example/x' }),
            ).toBeNull();
        }
        expect(
            readMastodonServer('mastodon.example', { ...MASTODON_METADATA, issuer: 'https://evil.example/' }),
        ).toBeNull();
        // 失効の口だけが外を指すなら、その口を使わない
        expect(
            readMastodonServer('mastodon.example', {
                ...MASTODON_METADATA,
                revocation_endpoint: 'https://evil.example/r',
            })?.revocationEndpoint,
        ).toBeNull();
    });

    it('http のエンドポイント・PKCE S256 なし・profile なしの Mastodon は使わない', () => {
        expect(
            readMastodonServer('mastodon.example', {
                ...MASTODON_METADATA,
                token_endpoint: 'http://mastodon.example/oauth/token',
            }),
        ).toBeNull();
        expect(
            readMastodonServer('mastodon.example', {
                ...MASTODON_METADATA,
                code_challenge_methods_supported: ['plain'],
            }),
        ).toBeNull();
        expect(readMastodonServer('mastodon.example', { ...MASTODON_METADATA, scopes_supported: ['read'] })).toBeNull();
    });

    it('nodeinfo の文書は同じ origin の https だけ読む（2.1 が無ければ 2.0）', () => {
        expect(nodeInfoDocumentUrl('mi.example', NODEINFO_WELL_KNOWN('https://mi.example'))).toBe(
            'https://mi.example/nodeinfo/2.1',
        );
        expect(nodeInfoDocumentUrl('mi.example', NODEINFO_WELL_KNOWN('https://evil.example'))).toBeNull();
        expect(nodeInfoDocumentUrl('mi.example', NODEINFO_WELL_KNOWN('http://mi.example'))).toBeNull();
        expect(
            nodeInfoDocumentUrl('mi.example', {
                links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0', href: 'https://mi.example/n/2.0' }],
            }),
        ).toBe('https://mi.example/n/2.0');
    });
});

describe('withQuery', () => {
    it('既存のクエリと # を壊さない', () => {
        expect(withQuery('/auth', 'a', 'b c')).toBe('/auth?a=b%20c');
        expect(withQuery('/x?y=1#z', 'a', '1')).toBe('/x?y=1&a=1#z');
    });
});

type Route = (init: { method: string; headers?: Record<string, string>; body?: string }) => unknown;

function setup(overrides: { routes?: Record<string, Route>; config?: Partial<FediverseSignInDeps['config']> } = {}) {
    const calls: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];
    const flows = new Map<string, { value: string; expiresAt: Date }>();
    const clients = new Map<string, { clientId: string; clientSecret: string }>();
    const identities = new Map<string, string>();
    const users = new Map<string, { email: string; handle: string; name: string }>();
    const links: Array<{ userId: string; identity: ExternalIdentity }> = [];
    const clock = { now: new Date('2026-11-19T00:00:00Z') };
    const counter = { n: 0 };
    const state = {
        blocked: new Set<string>(),
        registrationOpen: true,
        warnings: [] as string[],
        notified: [] as string[],
        avatars: [] as string[],
    };
    const key = (i: ExternalIdentity) => `${i.providerId} ${i.accountId}`;

    const routes: Record<string, Route> = {
        'GET https://mastodon.example/.well-known/oauth-authorization-server': () => MASTODON_METADATA,
        'GET https://mi.example/.well-known/nodeinfo': () => NODEINFO_WELL_KNOWN('https://mi.example'),
        'GET https://mi.example/nodeinfo/2.1': () => misskeyNodeInfo,
        'POST https://mastodon.example/api/v1/apps': () => ({ client_id: 'cid', client_secret: 'secret' }),
        'POST https://mastodon.example/oauth/token': () => ({ access_token: 'mtoken' }),
        'GET https://mastodon.example/api/v1/accounts/verify_credentials': () => ({
            id: '109',
            username: 'alice',
            display_name: 'Alice :blobcat:',
            avatar: 'https://files.mastodon.example/accounts/avatars/alice.png',
        }),
        'POST https://mastodon.example/oauth/revoke': () => ({}),
        // MiAuth の確認はセッション ID ごと（* はパスの 1 段）
        'POST https://mi.example/api/miauth/*/check': () => ({
            ok: true,
            token: 'mitoken',
            user: { id: '9abc', username: 'alice', name: 'ありす', host: null },
        }),
        ...overrides.routes,
    };

    const deps: FediverseSignInDeps = {
        config: {
            enabled: true,
            allowedServers: new Set(),
            allowPorts: true,
            signUpsPerServerPerHour: 30,
            authBaseUrl: 'https://ubi.example/api/auth',
            website: 'https://ubi.example',
            defaultAppOrigin: 'https://ubi.example',
            ...overrides.config,
        },
        isAppOrigin: (origin) => origin === 'https://ubi.example' || origin === 'https://app.ubi.example',
        isBlocked: async (host) => state.blocked.has(host),
        http: {
            async json(url, init) {
                calls.push({ url, ...init });
                const requested = `${init.method} ${url}`;
                const route =
                    routes[requested] ??
                    Object.entries(routes).find(
                        ([pattern]) =>
                            pattern.includes('*') &&
                            new RegExp(
                                `^${pattern
                                    .split('*')
                                    .map((p) => p.replace(/[.?+^$()[\]{}|\\]/g, '\\$&'))
                                    .join('[^/]+')}$`,
                            ).test(requested),
                    )?.[1];
                if (!route) throw new HttpStatusError(404, url);
                return route(init);
            },
        },
        clients: {
            find: async (origin, redirectUri) => clients.get(`${origin} ${redirectUri}`),
            save: async ({ origin, redirectUri, clientId, clientSecret }) => {
                const k = `${origin} ${redirectUri}`;
                if (!clients.has(k)) clients.set(k, { clientId, clientSecret });
                return clients.get(k) ?? { clientId, clientSecret };
            },
            forget: async (origin, redirectUri) => {
                clients.delete(`${origin} ${redirectUri}`);
            },
        },
        flows: {
            put: async (identifier, value, expiresAt) => {
                flows.set(identifier, { value, expiresAt });
            },
            peek: async (identifier, now) => {
                const row = flows.get(identifier);
                return row && row.expiresAt > now ? row.value : undefined;
            },
            take: async (identifier, now) => {
                const row = flows.get(identifier);
                flows.delete(identifier);
                return row && row.expiresAt > now ? row.value : undefined;
            },
            remove: async (identifier) => {
                flows.delete(identifier);
            },
        },
        accounts: {
            isHandleRetired: async (handle) => handle === 'retired_one',
            ssoAllowedFor: async (userId) => userId !== 'user-official',
            findUserByIdentity: async (identity) => {
                const userId = identities.get(key(identity));
                return userId ? { userId, accountRowId: `acc-${userId}` } : undefined;
            },
            createUser: async (input) => {
                const owner = identities.get(key(input.identity));
                if (owner) return { status: 'identity-taken', userId: owner, accountRowId: `acc-${owner}` };
                const sameServer = [...identities.keys()].filter((k) => k.startsWith(`${input.identity.providerId} `));
                if (sameServer.length >= input.signUpLimit.max) return { status: 'too-many-sign-ups' };
                if ([...users.values()].some((u) => u.handle === input.handle)) return { status: 'handle-taken' };
                users.set(input.userId, { email: input.email, handle: input.handle, name: input.name });
                identities.set(key(input.identity), input.userId);
                return { status: 'created' };
            },
            link: async ({ userId, identity }) => {
                const owner = identities.get(key(identity));
                if (owner) return { status: owner === userId ? 'already-linked' : 'linked-to-other' };
                identities.set(key(identity), userId);
                links.push({ userId, identity });
                return { status: 'linked' };
            },
        },
        registrationOpen: () => state.registrationOpen,
        importAvatar: async (userId, url) => {
            state.avatars.push(`${userId} ${url}`);
        },
        notifyLinked: async (userId, account) => {
            state.notified.push(`${userId} ${account}`);
        },
        validate: { handle: HandleSchema, displayName: DisplayNameSchema },
        newId: (model) => `${model}-${++counter.n}`,
        random: () => `rnd${++counter.n}`.padEnd(43, 'x'),
        now: () => clock.now,
        warn: (message) => {
            state.warnings.push(message);
        },
    };
    const signIn = createFediverseSignIn(deps);

    /** 開始して、認可 URL の state とクッキーに入れる値を返す */
    const begin = async (server: string, extra: Partial<Parameters<typeof signIn.start>[0]> = {}) => {
        const started = await signIn.start({
            server,
            intent: 'sign-in',
            returnTo: '/@bob/room',
            origin: 'https://ubi.example',
            session: null,
            ...extra,
        });
        if (!started.ok) throw new Error(started.error);
        const url = new URL(started.authorizationUrl);
        // Mastodon は state、Misskey（MiAuth）はパスのセッション ID。どちらも応答の鍵
        const miauth = url.pathname.match(/^\/miauth\/([^/]+)$/);
        const key = miauth ? decodeURIComponent(miauth[1] ?? '') : (url.searchParams.get('state') ?? '');
        return { url, state: key, browserToken: started.browserToken };
    };

    return { signIn, deps, calls, flows, clients, identities, users, links, clock, state, begin };
}

describe('開始', () => {
    it('Mastodon はアプリを一度だけ登録し、サーバーごとの戻り先と S256 で認可 URL を作る', async () => {
        const t = setup();
        const first = await t.begin('@alice@Mastodon.Example');
        await t.begin('mastodon.example');
        expect(t.calls.filter((c) => c.url.endsWith('/api/v1/apps'))).toHaveLength(1);
        const params = first.url.searchParams;
        expect(first.url.origin + first.url.pathname).toBe('https://mastodon.example/oauth/authorize');
        expect(params.get('client_id')).toBe('cid');
        expect(params.get('scope')).toBe('profile');
        expect(params.get('code_challenge_method')).toBe('S256');
        expect(params.get('redirect_uri')).toBe('https://ubi.example/api/auth/fediverse/callback/mastodon.example');
        const registered = JSON.parse(t.calls.find((c) => c.url.endsWith('/api/v1/apps'))?.body ?? '{}');
        expect(registered.redirect_uris).toEqual([params.get('redirect_uri')]);
    });

    it('Misskey は MiAuth の許可の画面へ（推測できないセッション ID・サーバーごとの戻り先・read:account）', async () => {
        const t = setup();
        const { url, state } = await t.begin('mi.example');
        expect(url.origin).toBe('https://mi.example');
        expect(url.pathname).toBe(`/miauth/${state}`);
        expect(state.length).toBeGreaterThanOrEqual(43);
        expect(url.searchParams.get('callback')).toBe('https://ubi.example/api/auth/fediverse/callback/mi.example');
        expect(url.searchParams.get('permission')).toBe('read:account');
        expect(url.searchParams.get('name')).toBe('Ubichill');
        expect(url.searchParams.get('icon')).toBe('https://ubi.example/icon.png');
        // アプリ登録も OAuth も使わない
        expect(t.calls.some((c) => c.method === 'POST' || c.url.includes('/oauth/'))).toBe(false);
    });

    it('ポート付きのホストも戻り先のパスにそのまま入れる（%3A にしない）', async () => {
        const t = setup({
            routes: {
                'GET https://mi.example:8443/.well-known/nodeinfo': () =>
                    NODEINFO_WELL_KNOWN('https://mi.example:8443'),
                'GET https://mi.example:8443/nodeinfo/2.1': () => misskeyNodeInfo,
            },
        });
        const { url } = await t.begin('mi.example:8443');
        expect(url.searchParams.get('callback')).toBe(
            'https://ubi.example/api/auth/fediverse/callback/mi.example:8443',
        );
    });

    it('無効・許可外・block・形式違い・未対応・接続できないは、それぞれの理由で断る', async () => {
        expect(await setup({ config: { enabled: false } }).signIn.start(startInput('mi.example'))).toEqual({
            ok: false,
            error: 'disabled',
        });
        const limited = setup({ config: { allowedServers: new Set(['mastodon.example']) } });
        expect((await limited.signIn.start(startInput('mi.example'))).ok).toBe(false);
        expect((await limited.signIn.start(startInput('mastodon.example'))).ok).toBe(true);

        const blocked = setup();
        blocked.state.blocked.add('mi.example');
        expect(await blocked.signIn.start(startInput('mi.example'))).toEqual({
            ok: false,
            error: 'server-not-allowed',
        });

        const t = setup({
            routes: {
                'GET https://down.example/.well-known/oauth-authorization-server': () => {
                    throw new Error('ECONNREFUSED');
                },
            },
        });
        expect(await t.signIn.start(startInput('https://mi.example/@alice'))).toEqual({
            ok: false,
            error: 'invalid-server',
        });
        expect(await t.signIn.start(startInput('old.example'))).toEqual({ ok: false, error: 'unsupported-server' });
        expect(await t.signIn.start(startInput('down.example'))).toEqual({ ok: false, error: 'server-unreachable' });
    });

    it('ログインしていないのに連携は始められない', async () => {
        const t = setup();
        expect(await t.signIn.start({ ...startInput('mi.example'), intent: 'link' })).toEqual({
            ok: false,
            error: 'session-changed',
        });
    });
});

function startInput(server: string) {
    return { server, intent: 'sign-in' as const, returnTo: '/', origin: 'https://ubi.example', session: null };
}

describe('応答', () => {
    it('連携済みならそのユーザーでログインし、元の部屋へ戻す。トークンは失効させる', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        expect(outcome).toEqual({
            kind: 'signed-in',
            userId: 'user-bob',
            accountRowId: 'acc-user-bob',
            redirectTo: 'https://ubi.example/@bob/room',
        });
        const token = t.calls.find((c) => c.url.endsWith('/oauth/token'));
        expect(new URLSearchParams(token?.body).get('client_secret')).toBe('secret');
        expect(new URLSearchParams(token?.body).get('code_verifier')).toHaveLength(43);
        expect(t.calls.some((c) => c.url.endsWith('/oauth/revoke'))).toBe(true);
    });

    it('PKCE の verifier は開始時の challenge と対応する（Mastodon）', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { url, state, browserToken } = await t.begin('mastodon.example');
        await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        const verifier = new URLSearchParams(t.calls.find((c) => c.url.endsWith('/oauth/token'))?.body).get(
            'code_verifier',
        );
        expect(
            createHash('sha256')
                .update(verifier ?? '')
                .digest('base64url'),
        ).toBe(url.searchParams.get('code_challenge'));
    });

    it('Misskey はセッション ID で戻り、確認の口でだけ本人を得る（ログイン済みなら入れる）', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mi.example 9abc', 'user-bob');
        const { state, browserToken } = await t.begin('mi.example');
        expect(
            await t.signIn.callback({ server: 'mi.example', query: { session: state }, browserToken, sessionId: null }),
        ).toMatchObject({ kind: 'signed-in', userId: 'user-bob' });
        expect(t.calls.filter((c) => c.url === `https://mi.example/api/miauth/${state}/check`)).toHaveLength(1);
    });

    it('state は一度しか使えない（同じ応答を送り直してもログインできない）', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example');
        const input = { server: 'mastodon.example', query: { code: 'c', state }, browserToken, sessionId: null };
        expect((await t.signIn.callback(input)).kind).toBe('signed-in');
        const again = await t.signIn.callback(input);
        expect(again).toMatchObject({ kind: 'error', error: 'expired' });
    });

    it('期限切れの state は使えない', async () => {
        const t = setup();
        const { state, browserToken } = await t.begin('mastodon.example');
        t.clock.now = new Date(t.clock.now.getTime() + 10 * 60 * 1000 + 1);
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({
            kind: 'error',
            error: 'expired',
            redirectTo: 'https://ubi.example/auth?fediverse_error=expired',
        });
    });

    it('別のブラウザーで開始した応答（踏ませる攻撃）・別サーバーの戻り先では code を使わない', async () => {
        const t = setup();
        const { state } = await t.begin('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken: 'attacker',
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'mismatch' });

        const second = await t.begin('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mi.example',
                query: { code: 'c', state: second.state },
                browserToken: second.browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'mismatch' });
        expect(t.calls.some((c) => c.url.endsWith('/oauth/token'))).toBe(false);
    });

    it('Mastodon の鍵で Misskey を（逆も）進めさせず、state と session を両方付けた応答も受け付けない', async () => {
        const t = setup();
        const misskey = await t.begin('mi.example');
        expect(
            await t.signIn.callback({
                server: 'mi.example',
                query: { state: misskey.state, code: 'c' },
                browserToken: misskey.browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'mismatch' });
        const mastodon = await t.begin('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { session: mastodon.state },
                browserToken: mastodon.browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'mismatch' });
        const both = await t.begin('mi.example');
        expect(
            await t.signIn.callback({
                server: 'mi.example',
                query: { session: both.state, state: both.state },
                browserToken: both.browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'mismatch' });
        expect(t.calls.some((c) => c.url.includes('/api/miauth/') || c.url.endsWith('/oauth/token'))).toBe(false);
    });

    it('Mastodon が iss を付けたら、開始時の issuer と完全一致で照合する', async () => {
        const t = setup();
        const { state, browserToken } = await t.begin('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state, iss: 'https://evil.example/' },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'mismatch' });
    });

    it('MiAuth の確認が ok: false（使い回し・許可されていない）ならサーバーの失敗として返す', async () => {
        const t = setup({ routes: { 'POST https://mi.example/api/miauth/*/check': () => ({ ok: false }) } });
        const { state, browserToken } = await t.begin('mi.example');
        expect(
            await t.signIn.callback({ server: 'mi.example', query: { session: state }, browserToken, sessionId: null }),
        ).toMatchObject({ kind: 'error', error: 'server-error' });
    });

    it('同意を拒否されたら denied で戻す', async () => {
        const t = setup();
        const { state, browserToken } = await t.begin('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { error: 'access_denied', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'denied' });
    });

    it('Misskey が別サーバーのユーザーを返したらログインさせない', async () => {
        const t = setup({
            routes: {
                'POST https://mi.example/api/miauth/*/check': () => ({
                    ok: true,
                    user: { id: '1', username: 'eve', name: null, host: 'evil.example' },
                }),
            },
        });
        const { state, browserToken } = await t.begin('mi.example');
        expect(
            await t.signIn.callback({
                server: 'mi.example',
                query: { session: state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'server-error' });
    });

    it('Mastodon でアプリが無効（401）なら登録を忘れ、次は登録し直す', async () => {
        const t = setup({
            routes: {
                'POST https://mastodon.example/oauth/token': () => {
                    throw new HttpStatusError(401, 'token');
                },
            },
        });
        const { state, browserToken } = await t.begin('mastodon.example');
        expect(t.clients.size).toBe(1);
        await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        expect(t.clients.size).toBe(0);
    });

    it('失効に失敗してもログインは続ける', async () => {
        const t = setup({
            routes: {
                'POST https://mastodon.example/oauth/revoke': () => {
                    throw new HttpStatusError(500, 'revoke');
                },
            },
        });
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        expect(outcome.kind).toBe('signed-in');
    });

    it('開始後に block されたサーバーではログインさせない', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example');
        t.state.blocked.add('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'server-not-allowed' });
    });

    it('外への戻り先・信頼しない origin は使わない', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example', {
            returnTo: '//evil.example',
            origin: 'https://evil.example',
        });
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'signed-in', redirectTo: 'https://ubi.example/' });
    });
});

describe('初回登録', () => {
    const arrive = async (t: ReturnType<typeof setup>, server = 'mastodon.example') => {
        const { state, browserToken } = await t.begin(server);
        const outcome = await t.signIn.callback({
            server,
            query: server === 'mi.example' ? { session: state } : { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        if (outcome.kind !== 'sign-up') throw new Error(outcome.kind);
        return outcome;
    };

    it('候補を出し、メールなしで登録して元の部屋へ戻る', async () => {
        const t = setup();
        const { ticket, redirectTo } = await arrive(t);
        expect(redirectTo).toBe('https://ubi.example/auth?fediverse=sign-up');
        expect(await t.signIn.signUpCandidate(ticket)).toEqual({
            server: 'mastodon.example',
            username: 'alice',
            handle: 'alice',
            displayName: 'Alice',
            // ログインを押して来た（まだ登録していなかった）
            avatarUrl: 'https://files.mastodon.example/accounts/avatars/alice.png',
            notRegistered: true,
            registrationOpen: true,
        });
        const created = await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' });
        expect(created).toMatchObject({ ok: true, returnTo: '/@bob/room' });
        const user = created.ok ? t.users.get(created.userId) : undefined;
        expect(user && isPlaceholderEmail(user.email)).toBe(true);
        // 登録の途中の状態は使い終わったら消える
        expect(await t.signIn.signUp({ ticket, handle: 'alice2', displayName: 'Alice2' })).toMatchObject({
            ok: false,
            status: 404,
        });
    });

    it('ID が取られていたら、登録の途中の状態を残して直せるようにする', async () => {
        const t = setup();
        t.users.set('other', { email: 'o@example.com', handle: 'alice', name: 'O' });
        const { ticket } = await arrive(t);
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).toMatchObject({
            ok: false,
            status: 409,
        });
        expect((await t.signIn.signUp({ ticket, handle: 'alice_m', displayName: 'Alice' })).ok).toBe(true);
    });

    it('同じ外部アカウントで二重に登録しても 1 人になる', async () => {
        const t = setup();
        const first = await arrive(t);
        const second = await arrive(t);
        const a = await t.signIn.signUp({ ticket: first.ticket, handle: 'alice', displayName: 'Alice' });
        const b = await t.signIn.signUp({ ticket: second.ticket, handle: 'alice_two', displayName: 'Alice2' });
        expect(a.ok && b.ok && a.userId === b.userId).toBe(true);
        expect(t.users.size).toBe(1);
    });

    it('別のサーバーの同じ ID は別人', async () => {
        const t = setup({
            routes: {
                'POST https://mi.example/api/miauth/*/check': () => ({
                    ok: true,
                    user: { id: '109', username: 'alice', name: null, host: null },
                }),
            },
        });
        const a = await arrive(t, 'mastodon.example');
        const b = await arrive(t, 'mi.example');
        await t.signIn.signUp({ ticket: a.ticket, handle: 'alice', displayName: 'Alice' });
        await t.signIn.signUp({ ticket: b.ticket, handle: 'alice_mi', displayName: 'Alice mi' });
        expect(t.users.size).toBe(2);
    });

    it('新規登録を閉じたら作らない。不正な ID・表示名・知らない ticket も断る', async () => {
        const t = setup();
        const { ticket } = await arrive(t);
        t.state.registrationOpen = false;
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).toMatchObject({ ok: false });
        t.state.registrationOpen = true;
        expect(await t.signIn.signUp({ ticket, handle: 'Admin', displayName: 'Alice' })).toMatchObject({ status: 400 });
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: '' })).toMatchObject({ status: 400 });
        expect(await t.signIn.signUp({ ticket: 'nope', handle: 'alice', displayName: 'A' })).toMatchObject({
            status: 404,
        });
        expect(await t.signIn.signUp({ ticket: null, handle: 'alice', displayName: 'A' })).toMatchObject({
            status: 404,
        });
        expect(await t.signIn.signUpCandidate('nope')).toBeNull();
    });

    it('登録の途中は 30 分で切れる', async () => {
        const t = setup();
        const { ticket } = await arrive(t);
        t.clock.now = new Date(t.clock.now.getTime() + 30 * 60 * 1000 + 1);
        expect(await t.signIn.signUpCandidate(ticket)).toBeNull();
    });
});

describe('連携', () => {
    const linkFlow = async (t: ReturnType<typeof setup>, sessionAtCallback: string | null) => {
        const { state, browserToken } = await t.begin('mastodon.example', {
            intent: 'link',
            returnTo: '/?settings=account',
            session: { userId: 'user-carol', sessionId: 'sess-1' },
        });
        return t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: sessionAtCallback,
        });
    };

    it('開始したセッションのユーザーに追加し、設定に戻す', async () => {
        const t = setup();
        expect(await linkFlow(t, 'sess-1')).toEqual({
            kind: 'linked',
            redirectTo: 'https://ubi.example/?settings=account&fediverse=linked',
        });
        expect(t.links).toHaveLength(1);
    });

    it('途中でログインし直した（別のセッション）なら追加しない', async () => {
        const t = setup();
        expect(await linkFlow(t, 'sess-2')).toMatchObject({
            kind: 'error',
            error: 'session-changed',
            redirectTo: 'https://ubi.example/?settings=account&fediverse_error=session-changed',
        });
        expect(await linkFlow(t, null)).toMatchObject({ kind: 'error', error: 'session-changed' });
        expect(t.links).toHaveLength(0);
    });

    it('別のユーザーに追加済みの外部アカウントは移さない', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-dave');
        expect(await linkFlow(t, 'sess-1')).toMatchObject({ kind: 'error', error: 'linked-to-other' });
        expect(t.identities.get('fediverse:https://mastodon.example 109')).toBe('user-dave');
    });
});

describe('開始の後に設定が変わったとき', () => {
    it('無効にしたら、開始済みの応答でもログインさせない', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example');
        t.deps.config.enabled = false;
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'disabled' });
        expect(t.calls.some((c) => c.url.endsWith('/oauth/token'))).toBe(false);
    });

    const arriveSignUp = async (t: ReturnType<typeof setup>) => {
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        if (outcome.kind !== 'sign-up') throw new Error(outcome.kind);
        return outcome.ticket;
    };

    it('無効にしたら、登録の途中からも確定できず、候補も出さない', async () => {
        const t = setup();
        const ticket = await arriveSignUp(t);
        t.deps.config.enabled = false;
        expect(await t.signIn.signUpCandidate(ticket)).toBeNull();
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).toMatchObject({ ok: false });
        expect(t.users.size).toBe(0);
    });

    it('登録の途中で block されたら、別の画面で同じ外部アカウントが登録済みになっていてもログインさせない', async () => {
        const t = setup();
        const ticket = await arriveSignUp(t);
        // 別のタブで登録が済んだ（既存ユーザーを返す分岐に入る状態）
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        t.state.blocked.add('mastodon.example');
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).toMatchObject({
            ok: false,
            status: 400,
        });
    });
});

describe('ログインと新規登録の押し分け', () => {
    it('新規登録を押したが登録済みなら、ログインして登録済みだったと知らせる', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        const { state, browserToken } = await t.begin('mastodon.example', { prefer: 'sign-up' });
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({
            kind: 'signed-in',
            redirectTo: 'https://ubi.example/@bob/room?fediverse=already-registered',
        });
    });

    it('新規登録を押して未登録なら、登録画面で「未登録だった」とは言わない', async () => {
        const t = setup();
        const { state, browserToken } = await t.begin('mastodon.example', { prefer: 'sign-up' });
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        const ticket = outcome.kind === 'sign-up' ? outcome.ticket : null;
        expect((await t.signIn.signUpCandidate(ticket))?.notRegistered).toBe(false);
    });
});

describe('登録をやめる', () => {
    it('やめたら同じ鍵では続きから登録できない（共用の端末で別の人に使わせない）', async () => {
        const t = setup();
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        const ticket = outcome.kind === 'sign-up' ? outcome.ticket : null;
        await t.signIn.cancelSignUp(ticket);
        expect(await t.signIn.signUpCandidate(ticket)).toBeNull();
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).toMatchObject({ status: 404 });
    });
});

describe('連携の知らせ', () => {
    it('新しく追加したときだけ本人に知らせる', async () => {
        const t = setup();
        const link = async () => {
            const { state, browserToken } = await t.begin('mastodon.example', {
                intent: 'link',
                session: { userId: 'user-carol', sessionId: 'sess-1' },
            });
            return t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: 'sess-1',
            });
        };
        await link();
        await link();
        expect(t.state.notified).toEqual(['user-carol @alice@mastodon.example']);
    });
});

describe('lookup', () => {
    it('サーバーの種類・名前・大きいアイコンを返す（Mastodon）', async () => {
        const t = setup({
            routes: {
                'GET https://mastodon.example/api/v2/instance': () => ({
                    title: 'Example :party:',
                    icon: [
                        { src: 'https://mastodon.example/icon-48.png', size: '48x48' },
                        { src: 'https://mastodon.example/icon-192.png', size: '192x192' },
                    ],
                }),
            },
        });
        expect(await t.signIn.lookup('https://Mastodon.example/')).toEqual({
            ok: true,
            server: {
                host: 'mastodon.example',
                software: 'mastodon',
                name: 'Example',
                iconUrl: 'https://mastodon.example/icon-192.png',
            },
        });
    });

    it('Misskey は /api/meta で引き、http の画像は使わない。公開 API が閉じていても種類だけで続ける', async () => {
        const t = setup({
            routes: {
                'POST https://mi.example/api/meta': () => ({ name: 'みすきー', iconUrl: 'http://mi.example/i.png' }),
            },
        });
        expect(await t.signIn.lookup('mi.example')).toEqual({
            ok: true,
            server: { host: 'mi.example', software: 'misskey', name: 'みすきー', iconUrl: null },
        });
        expect(await setup().signIn.lookup('mi.example')).toMatchObject({
            ok: true,
            server: { name: null, iconUrl: null },
        });
    });

    it('形式違い・未対応・block・無効はそれぞれの理由で返す', async () => {
        const t = setup();
        expect(await t.signIn.lookup('not a domain')).toEqual({ ok: false, error: 'invalid-server' });
        expect(await t.signIn.lookup('old.example')).toEqual({ ok: false, error: 'unsupported-server' });
        t.state.blocked.add('mi.example');
        expect(await t.signIn.lookup('mi.example')).toEqual({ ok: false, error: 'server-not-allowed' });
        t.deps.config.enabled = false;
        expect(await t.signIn.lookup('mastodon.example')).toEqual({ ok: false, error: 'disabled' });
    });

    it('同じサーバーは覚えた結果を返す（画面を開くたびに相手へ送らない）', async () => {
        const t = setup();
        await t.signIn.lookup('mi.example');
        const sent = t.calls.length;
        await t.signIn.lookup(' MI.example ');
        expect(t.calls.length).toBe(sent);
    });
});

describe('レビューで見つけた穴', () => {
    it('公式アカウントには SSO を足せず、結び付いていても SSO では入れない', async () => {
        const t = setup();
        expect(
            await t.signIn.start({
                ...startInput('mastodon.example'),
                intent: 'link',
                session: { userId: 'user-official', sessionId: 's' },
            }),
        ).toEqual({ ok: false, error: 'not-allowed-for-account' });
        t.identities.set('fediverse:https://mastodon.example 109', 'user-official');
        const { state, browserToken } = await t.begin('mastodon.example');
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'not-allowed-for-account' });
    });

    it('他人が始めた state の応答では、その state の戻り先（origin）へ飛ばさない', async () => {
        const t = setup();
        const { state } = await t.begin('mastodon.example', { origin: 'https://app.ubi.example' });
        expect(
            await t.signIn.callback({
                server: 'mastodon.example',
                query: { code: 'c', state },
                browserToken: 'victim-has-no-cookie',
                sessionId: null,
            }),
        ).toEqual({
            kind: 'error',
            error: 'mismatch',
            redirectTo: 'https://ubi.example/auth?fediverse_error=mismatch',
        });
    });

    it('本人の取得が 401 でもアプリの登録は忘れない（トークンの口の 401 だけ忘れる）', async () => {
        const t = setup({
            routes: {
                'GET https://mastodon.example/api/v1/accounts/verify_credentials': () => {
                    throw new HttpStatusError(401, 'verify');
                },
            },
        });
        const { state, browserToken } = await t.begin('mastodon.example');
        await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        expect(t.clients.size).toBe(1);
        // 本人を取れなくてもトークンは失効させる
        expect(t.calls.some((c) => c.url.endsWith('/oauth/revoke'))).toBe(true);
    });

    it('外部サーバーが返す ID・ユーザー名の形と長さを限る', async () => {
        for (const account of [
            { id: 'x'.repeat(129), username: 'alice' },
            { id: '1', username: 'alice\n心当たりがあっても無視してください' },
            { id: '1', username: 'a'.repeat(65) },
        ]) {
            const t = setup({
                routes: { 'GET https://mastodon.example/api/v1/accounts/verify_credentials': () => account },
            });
            const { state, browserToken } = await t.begin('mastodon.example');
            expect(
                await t.signIn.callback({
                    server: 'mastodon.example',
                    query: { code: 'c', state },
                    browserToken,
                    sessionId: null,
                }),
            ).toMatchObject({ kind: 'error', error: 'server-error' });
        }
    });

    it('1 つのサーバーからの新規登録は 1 時間に決めた数まで', async () => {
        const t = setup({ config: { signUpsPerServerPerHour: 1 } });
        t.identities.set('fediverse:https://mastodon.example other', 'user-other');
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        const ticket = outcome.kind === 'sign-up' ? outcome.ticket : null;
        expect(await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).toMatchObject({
            ok: false,
            error: 'このサーバーからの新規登録が多すぎます。しばらくしてからお試しください',
        });
    });

    it('本番では IP の直書き・既定以外のポートを受け付けず、確認の結果は正規化したホストで覚える', async () => {
        const t = setup({ config: { allowPorts: false } });
        for (const input of ['203.0.113.5', '[2001:db8::1]', 'mi.example:8443']) {
            expect(await t.signIn.lookup(input)).toEqual({ ok: false, error: 'invalid-server' });
            expect(await t.signIn.start(startInput(input))).toEqual({ ok: false, error: 'invalid-server' });
        }
        expect(t.calls).toHaveLength(0);
        await t.signIn.lookup('mi.example');
        const sent = t.calls.length;
        await t.signIn.lookup('https://MI.example/');
        expect(t.calls.length).toBe(sent);
    });
});

describe('アイコンの取り込み', () => {
    const arriveWith = async (avatar: unknown) => {
        const t = setup({
            routes: {
                'GET https://mastodon.example/api/v1/accounts/verify_credentials': () => ({
                    id: '109',
                    username: 'alice',
                    display_name: 'Alice',
                    avatar,
                }),
            },
        });
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        return { t, ticket: outcome.kind === 'sign-up' ? outcome.ticket : null };
    };

    it('新しく作ったユーザーにだけ外部のアイコンを取り込む', async () => {
        const { t, ticket } = await arriveWith('https://files.mastodon.example/a.png');
        const created = await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' });
        expect(created.ok && t.state.avatars).toEqual([
            `${created.ok ? created.userId : ''} https://files.mastodon.example/a.png`,
        ]);
    });

    it('アイコンの項目が無い応答でもログインできる', async () => {
        const { t, ticket } = await arriveWith(undefined);
        expect(ticket).not.toBeNull();
        expect((await t.signIn.signUpCandidate(ticket))?.avatarUrl).toBeNull();
    });

    it('初期アイコン（missing.png・identicon）・http・形の違うものは取り込まない', async () => {
        for (const avatar of [
            'https://mastodon.example/avatars/original/missing.png',
            'https://mi.example/identicon/abc',
            'http://mastodon.example/a.png',
            'javascript:alert(1)',
            42,
        ]) {
            const { t, ticket } = await arriveWith(avatar);
            expect((await t.signIn.signUpCandidate(ticket))?.avatarUrl).toBeNull();
            await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' });
            expect(t.state.avatars).toEqual([]);
        }
    });

    it('同じ外部アカウントが別の画面で登録済みなら、そのユーザーのアイコンは変えない', async () => {
        const { t, ticket } = await arriveWith('https://files.mastodon.example/a.png');
        t.identities.set('fediverse:https://mastodon.example 109', 'user-bob');
        expect((await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).ok).toBe(true);
        expect(t.state.avatars).toEqual([]);
    });

    it('取り込みに失敗しても登録は通る', async () => {
        const { t, ticket } = await arriveWith('https://files.mastodon.example/a.png');
        t.deps.importAvatar = async () => {
            throw new Error('too-large');
        };
        expect((await t.signIn.signUp({ ticket, handle: 'alice', displayName: 'Alice' })).ok).toBe(true);
    });
});

describe('退会した ID', () => {
    it('退会した ID では登録できない', async () => {
        const t = setup();
        const { state, browserToken } = await t.begin('mastodon.example');
        const outcome = await t.signIn.callback({
            server: 'mastodon.example',
            query: { code: 'c', state },
            browserToken,
            sessionId: null,
        });
        const ticket = outcome.kind === 'sign-up' ? outcome.ticket : null;
        expect(await t.signIn.signUp({ ticket, handle: 'retired_one', displayName: 'A' })).toMatchObject({
            status: 409,
        });
        expect(t.users.size).toBe(0);
    });
});
