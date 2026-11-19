import { createHash } from 'node:crypto';
import { DisplayNameSchema, HandleSchema, isPlaceholderEmail } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { readAuthorizationServer } from './discovery';
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

const MISSKEY_METADATA = {
    issuer: 'https://mi.example',
    authorization_endpoint: 'https://mi.example/oauth/authorize',
    token_endpoint: 'https://mi.example/oauth/token',
    scopes_supported: ['read:account', 'write:notes'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
};

describe('readAuthorizationServer', () => {
    it('Mastodon と Misskey を備えるもので見分ける', () => {
        const mastodon = readAuthorizationServer('mastodon.example', MASTODON_METADATA);
        const misskey = readAuthorizationServer('mi.example', MISSKEY_METADATA);
        expect(mastodon.ok && mastodon.server.software).toBe('mastodon');
        expect(misskey.ok && misskey.server.software).toBe('misskey');
    });

    it('エンドポイントが別のホストを指すサーバーは使わない（資格情報を外へ送らせない）', () => {
        for (const key of ['authorization_endpoint', 'token_endpoint'] as const) {
            expect(
                readAuthorizationServer('mi.example', { ...MISSKEY_METADATA, [key]: 'https://evil.example/oauth/x' })
                    .ok,
            ).toBe(false);
        }
        expect(readAuthorizationServer('mi.example', { ...MISSKEY_METADATA, issuer: 'https://evil.example' }).ok).toBe(
            false,
        );
        // 失効・登録の口だけが外を指すなら、その口を使わない
        const server = readAuthorizationServer('mastodon.example', {
            ...MASTODON_METADATA,
            revocation_endpoint: 'https://evil.example/revoke',
        });
        expect(server.ok && server.server.revocationEndpoint).toBeNull();
    });

    it('http のエンドポイント・PKCE S256 なし・iss なしの Misskey は使わない', () => {
        expect(
            readAuthorizationServer('mi.example', {
                ...MISSKEY_METADATA,
                token_endpoint: 'http://mi.example/oauth/token',
            }).ok,
        ).toBe(false);
        expect(
            readAuthorizationServer('mi.example', { ...MISSKEY_METADATA, code_challenge_methods_supported: ['plain'] })
                .ok,
        ).toBe(false);
        expect(
            readAuthorizationServer('mi.example', {
                ...MISSKEY_METADATA,
                authorization_response_iss_parameter_supported: false,
            }).ok,
        ).toBe(false);
        expect(readAuthorizationServer('mi.example', 'not json').ok).toBe(false);
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
    };
    const key = (i: ExternalIdentity) => `${i.providerId} ${i.accountId}`;

    const routes: Record<string, Route> = {
        'GET https://mastodon.example/.well-known/oauth-authorization-server': () => MASTODON_METADATA,
        'GET https://mi.example/.well-known/oauth-authorization-server': () => MISSKEY_METADATA,
        'POST https://mastodon.example/api/v1/apps': () => ({ client_id: 'cid', client_secret: 'secret' }),
        'POST https://mastodon.example/oauth/token': () => ({ access_token: 'mtoken' }),
        'GET https://mastodon.example/api/v1/accounts/verify_credentials': () => ({
            id: '109',
            username: 'alice',
            display_name: 'Alice :blobcat:',
        }),
        'POST https://mastodon.example/oauth/revoke': () => ({}),
        'POST https://mi.example/oauth/token': () => ({ access_token: 'mitoken' }),
        'POST https://mi.example/api/i': () => ({ id: '9abc', username: 'alice', name: 'ありす', host: null }),
        ...overrides.routes,
    };

    const deps: FediverseSignInDeps = {
        config: {
            enabled: true,
            allowedServers: new Set(),
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
                const route = routes[`${init.method} ${url}`];
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
            findUserByIdentity: async (identity) => {
                const userId = identities.get(key(identity));
                return userId ? { userId, accountRowId: `acc-${userId}` } : undefined;
            },
            createUser: async (input) => {
                const owner = identities.get(key(input.identity));
                if (owner) return { status: 'identity-taken', userId: owner, accountRowId: `acc-${owner}` };
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
        return { url, state: url.searchParams.get('state') ?? '', browserToken: started.browserToken };
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

    it('Misskey は登録せず、client_id に Ubichill の URL を使う', async () => {
        const t = setup();
        const { url } = await t.begin('mi.example');
        expect(url.searchParams.get('client_id')).toBe('https://ubi.example/api/auth/fediverse/client/mi.example');
        expect(url.searchParams.get('scope')).toBe('read:account');
        expect(t.calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('Misskey の client_id の文書は戻り先を載せ、読めないホストには出さない', () => {
        const t = setup();
        const doc = t.signIn.clientDocument('mi.example') ?? '';
        expect(doc).toContain(
            '<link rel="redirect_uri" href="https://ubi.example/api/auth/fediverse/callback/mi.example">',
        );
        expect(doc).toContain('href="https://ubi.example/api/auth/fediverse/client/mi.example" class="u-url p-name"');
        expect(t.signIn.clientDocument('MI.example')).toBeNull();
        expect(t.signIn.clientDocument('"><script>')).toBeNull();
    });

    it('ポート付きのホストも戻り先・client_id のパスにそのまま入れる（%3A にしない）', async () => {
        const t = setup({
            routes: {
                'GET https://mi.example:8443/.well-known/oauth-authorization-server': () => ({
                    ...MISSKEY_METADATA,
                    issuer: 'https://mi.example:8443',
                    authorization_endpoint: 'https://mi.example:8443/oauth/authorize',
                    token_endpoint: 'https://mi.example:8443/oauth/token',
                }),
            },
        });
        const { url } = await t.begin('mi.example:8443');
        expect(url.searchParams.get('redirect_uri')).toBe(
            'https://ubi.example/api/auth/fediverse/callback/mi.example:8443',
        );
        expect(url.searchParams.get('client_id')).toBe('https://ubi.example/api/auth/fediverse/client/mi.example:8443');
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

    it('PKCE の verifier は開始時の challenge と対応する', async () => {
        const t = setup();
        t.identities.set('fediverse:https://mi.example 9abc', 'user-bob');
        const { url, state, browserToken } = await t.begin('mi.example');
        await t.signIn.callback({
            server: 'mi.example',
            query: { code: 'c', state, iss: 'https://mi.example' },
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

    it('Misskey は iss が無い・違う応答を受け付けない', async () => {
        const t = setup();
        for (const iss of [undefined, 'https://evil.example', 'https://mi.example/']) {
            const { state, browserToken } = await t.begin('mi.example');
            expect(
                await t.signIn.callback({
                    server: 'mi.example',
                    query: { code: 'c', state, iss },
                    browserToken,
                    sessionId: null,
                }),
            ).toMatchObject({ kind: 'error', error: 'mismatch' });
        }
        expect(t.calls.some((c) => c.url.endsWith('/oauth/token'))).toBe(false);
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
                'POST https://mi.example/api/i': () => ({ id: '1', username: 'eve', name: null, host: 'evil.example' }),
            },
        });
        const { state, browserToken } = await t.begin('mi.example');
        expect(
            await t.signIn.callback({
                server: 'mi.example',
                query: { code: 'c', state, iss: 'https://mi.example' },
                browserToken,
                sessionId: null,
            }),
        ).toMatchObject({ kind: 'error', error: 'failed' });
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
            query: { code: 'c', state, iss: server === 'mi.example' ? 'https://mi.example' : undefined },
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
                'POST https://mi.example/api/i': () => ({ id: '109', username: 'alice', name: null, host: null }),
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
