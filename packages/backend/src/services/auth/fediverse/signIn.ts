/**
 * フェディバースのアカウントでのログイン・登録・連携の流れ（docs/design/fediverse-sign-in.md）。HTTP・DB・乱数・時刻は
 * 注入し、セッションの発行とクッキーは呼ぶ側（lib/fediverseSignInPlugin.ts の better-auth のエンドポイント）が持つ。
 *
 * - Mastodon は OAuth（認可コード + PKCE S256）、Misskey 系は MiAuth（discovery.ts の理由）。
 * - 開始で一度だけ使える鍵（Mastodon は state、Misskey は MiAuth のセッション ID）を作り、ブラウザーに渡した値の
 *   ハッシュと一緒に保存する（他人の認証応答を踏ませてログインさせる攻撃を防ぐ）。
 * - 応答は、開始時のサーバーと戻り先 URL（サーバーごとに違う）を照合してから使う。Mastodon は `iss` が付いていれば
 *   それも照合する。
 * - 初回は外部アカウントを指す登録の途中の状態を作り、ID と表示名を決めてもらってからユーザーを作る。
 */
import { createHash } from 'node:crypto';
import {
    type DisplayNameSchema,
    displayNameCandidateOf,
    displayNameKey,
    FEDIVERSE_SIGN_IN_ERRORS,
    type FediverseSignInError,
    type FediverseSignInIntent,
    type FediverseSignUpCandidate,
    fediverseProviderId,
    type HandleSchema,
    handleCandidateOf,
    parseFediverseServer,
    placeholderEmail,
    safeReturnTo,
} from '@ubichill/shared';
import { z } from 'zod';
import {
    type AuthorizationServer,
    type MastodonServer,
    nodeInfoDocumentUrl,
    readMastodonServer,
    readMisskeyServer,
} from './discovery';
import { createLookupCache, type LookupOutcome, lookupFediverseServer } from './lookup';
import {
    type ClientCredentials,
    checkMiAuth,
    type ExternalAccount,
    exchangeMastodonCode,
    type FediverseHttp,
    fetchMastodonAccount,
    HttpStatusError,
    mastodonAuthorizationUrl,
    miAuthUrl,
    registerMastodonApp,
    revokeMastodonToken,
} from './protocol';

export const STATE_TTL_MS = 10 * 60 * 1000;
export const SIGN_UP_TTL_MS = 15 * 60 * 1000;
const STATE_PREFIX = 'fediverse-state:';
const SIGN_UP_PREFIX = 'fediverse-sign-up:';

export interface ExternalIdentity {
    providerId: string;
    accountId: string;
    software: string;
    username: string;
}

export interface FediverseSignInDeps {
    config: {
        enabled: boolean;
        /** 空ならすべてのサーバー */
        allowedServers: ReadonlySet<string>;
        /** 既定（443）以外のポートのサーバーを受け付けるか（開発だけ。本番で任意のポートを試させない） */
        allowPorts: boolean;
        /** 1 つのサーバーから 1 時間に受け付ける新規登録の数（偽のサーバーでアカウントを量産させない） */
        signUpsPerServerPerHour: number;
        /** better-auth の baseURL（`https://example.com/api/auth`）。戻り先と Misskey の client_id を作る */
        authBaseUrl: string;
        /** Mastodon のアプリ登録に載せる Ubichill の URL */
        website: string;
        /** 開始時の Origin が使えないときに戻す画面の origin */
        defaultAppOrigin: string;
    };
    /** 画面の origin として受け付けるか（CORS の許可と同じ） */
    isAppOrigin(origin: string): boolean;
    /** 管理者が連合で block にしたドメインか */
    isBlocked(host: string): Promise<boolean>;
    http: FediverseHttp;
    clients: {
        find(origin: string, redirectUri: string): Promise<{ clientId: string; clientSecret: string } | undefined>;
        save(input: {
            origin: string;
            redirectUri: string;
            clientId: string;
            clientSecret: string;
        }): Promise<{ clientId: string; clientSecret: string }>;
        forget(origin: string, redirectUri: string): Promise<void>;
    };
    flows: {
        put(identifier: string, value: string, expiresAt: Date, id: string): Promise<void>;
        peek(identifier: string, now: Date): Promise<string | undefined>;
        take(identifier: string, now: Date): Promise<string | undefined>;
        remove(identifier: string): Promise<void>;
    };
    accounts: {
        /** このユーザーが SSO を使えるか（公式アカウントは使えない。外部サーバーに公式の作者の権限を渡さない） */
        ssoAllowedFor(userId: string): Promise<boolean>;
        /** そのサーバー（providerId）の外部アカウントが、ある時刻から後に何件結び付いたか */
        countLinkedSince(providerId: string, since: Date): Promise<number>;
        findUserByIdentity(
            identity: ExternalIdentity,
            now: Date,
        ): Promise<{ userId: string; accountRowId: string } | undefined>;
        createUser(input: {
            userId: string;
            accountRowId: string;
            email: string;
            name: string;
            handle: string;
            displayNameKey: string;
            identity: ExternalIdentity;
            now: Date;
        }): Promise<
            | { status: 'created' }
            | { status: 'identity-taken'; userId: string; accountRowId: string }
            | { status: 'handle-taken' }
            | { status: 'name-taken' }
        >;
        link(input: {
            userId: string;
            accountRowId: string;
            identity: ExternalIdentity;
            now: Date;
        }): Promise<{ status: 'linked' | 'already-linked' | 'linked-to-other' }>;
    };
    /** 新規登録を受け付けるか（閉じても既存ユーザーのログインと連携はできる） */
    registrationOpen(): boolean;
    /** ログイン方法を足したことを本人に知らせる（乗っ取りに気付けるように。連絡先が無ければ何もしない） */
    notifyLinked(userId: string, account: string): Promise<void>;
    validate: { handle: typeof HandleSchema; displayName: typeof DisplayNameSchema };
    newId(model: 'user' | 'account'): string;
    /** 推測できない 32 バイト以上の乱数（base64url） */
    random(): string;
    now(): Date;
    warn(message: string, error?: unknown): void;
}

const hash = (value: string) => createHash('sha256').update(value).digest('base64url');

const StoredServerSchema = z.discriminatedUnion('software', [
    z.object({
        software: z.literal('mastodon'),
        host: z.string(),
        origin: z.string(),
        issuer: z.string(),
        authorizationEndpoint: z.string(),
        tokenEndpoint: z.string(),
        revocationEndpoint: z.string().nullable(),
        registrationEndpoint: z.string(),
    }),
    z.object({ software: z.literal('misskey'), host: z.string(), origin: z.string() }),
]);

const StateSchema = z.object({
    server: StoredServerSchema,
    /** Mastodon のアプリの client_id（Misskey は空） */
    clientId: z.string(),
    redirectUri: z.string(),
    /** Mastodon の PKCE verifier（Misskey は空） */
    codeVerifier: z.string(),
    browserHash: z.string(),
    intent: z.enum(['sign-in', 'link']),
    /** 画面で押したのがログインか新規登録か（結果の知らせ方だけに使う。登録済みかは認証の前に明かさない） */
    prefer: z.enum(['sign-in', 'sign-up']),
    returnTo: z.string(),
    appOrigin: z.string(),
    link: z.object({ userId: z.string(), sessionId: z.string() }).nullable(),
});
type FlowState = z.infer<typeof StateSchema>;

const SignUpSchema = z.object({
    identity: z.object({
        providerId: z.string(),
        accountId: z.string(),
        software: z.string(),
        username: z.string(),
    }),
    host: z.string(),
    displayName: z.string().nullable(),
    returnTo: z.string(),
    /** ログインを押したが、まだ登録していなかった */
    notRegistered: z.boolean(),
});
type SignUpTicket = z.infer<typeof SignUpSchema>;

const readJson = <T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined => {
    if (raw === undefined) return undefined;
    try {
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
    } catch {
        return undefined;
    }
};

/** 相対 URL にクエリを 1 つ足す（# より前に入れる）。 */
export function withQuery(path: string, key: string, value: string): string {
    const [beforeHash, ...hashParts] = path.split('#');
    const separator = (beforeHash ?? '').includes('?') ? '&' : '?';
    const hashPart = hashParts.length ? `#${hashParts.join('#')}` : '';
    return `${beforeHash}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hashPart}`;
}

export type StartOutcome =
    | { ok: true; authorizationUrl: string; browserToken: string }
    | { ok: false; error: FediverseSignInError };

export type CallbackOutcome =
    | { kind: 'signed-in'; userId: string; accountRowId: string; redirectTo: string }
    | { kind: 'sign-up'; ticket: string; redirectTo: string }
    | { kind: 'linked'; redirectTo: string }
    | { kind: 'error'; error: FediverseSignInError; redirectTo: string };

export type SignUpOutcome =
    | { ok: true; userId: string; accountRowId: string; returnTo: string }
    | { ok: false; status: 400 | 404 | 409; error: string };

export function createFediverseSignIn(deps: FediverseSignInDeps) {
    // host は parseFediverseServer を通した小文字のホスト（英数字・`.`・`-`・ポートの `:`）なので、そのままパスに入れる。
    // エンコードすると `:` が `%3A` になり、戻り先の照合（authEndpoints）と URL の完全一致が崩れる
    const callbackUrlFor = (host: string) => `${deps.config.authBaseUrl}/fediverse/callback/${host}`;

    const serverAllowed = async (host: string): Promise<boolean> =>
        (deps.config.allowedServers.size === 0 || deps.config.allowedServers.has(host)) &&
        !(await deps.isBlocked(host));

    /** IP の直書きと、本番での既定以外のポートは受け付けない（公開 IP のポートを調べる手段にさせない）。 */
    const parseServer = (input: string): { ok: true; host: string } | { ok: false } => {
        const parsed = parseFediverseServer(input);
        if (!parsed.ok) return { ok: false };
        const hostname = parsed.host.replace(/:\d+$/, '');
        const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
        const hasPort = parsed.host !== hostname;
        return ipLiteral || (hasPort && !deps.config.allowPorts) ? { ok: false } : parsed;
    };

    const getJson = (url: string) => deps.http.json(url, { method: 'GET', headers: { Accept: 'application/json' } });
    // 4xx は「備えていない」。リダイレクトは追わないので 3xx も同じ扱い
    const isAbsent = (error: unknown) => error instanceof HttpStatusError && error.status >= 300 && error.status < 500;

    /** Mastodon は OAuth のメタデータ、Misskey 系は nodeinfo で見分ける（discovery.ts）。 */
    const discover = async (host: string): Promise<AuthorizationServer | 'unsupported' | 'unreachable'> => {
        try {
            const mastodon = await getJson(`https://${host}/.well-known/oauth-authorization-server`)
                .then((metadata) => readMastodonServer(host, metadata))
                .catch((error: unknown) => {
                    if (isAbsent(error)) return null;
                    throw error;
                });
            if (mastodon) return mastodon;
            const documentUrl = nodeInfoDocumentUrl(host, await getJson(`https://${host}/.well-known/nodeinfo`));
            if (!documentUrl) return 'unsupported';
            return readMisskeyServer(host, await getJson(documentUrl)) ?? 'unsupported';
        } catch (error) {
            if (isAbsent(error)) return 'unsupported';
            deps.warn(`フェディバースのサーバーに接続できません: ${host}`, error);
            return 'unreachable';
        }
    };

    const clientFor = async (server: MastodonServer, redirectUri: string): Promise<ClientCredentials> => {
        const saved = await deps.clients.find(server.origin, redirectUri);
        if (saved) return saved;
        const registered = await registerMastodonApp(deps.http, server, {
            redirectUri,
            clientName: `Ubichill (${new URL(deps.config.website).host})`,
            website: deps.config.website,
        });
        return deps.clients.save({ origin: server.origin, redirectUri, ...registered });
    };

    const storedClient = async (state: FlowState, server: MastodonServer): Promise<ClientCredentials | undefined> => {
        const saved = await deps.clients.find(server.origin, state.redirectUri);
        return saved?.clientId === state.clientId ? saved : undefined;
    };

    /** 認可コードをトークンに換えて本人を取り、トークンは失効させる。取れなければ null。 */
    const mastodonAccount = async (
        state: FlowState,
        server: MastodonServer,
        code: string,
    ): Promise<ExternalAccount | null> => {
        const client = await storedClient(state, server);
        if (!client) return null;
        const token = await exchangeMastodonCode(deps.http, server, {
            client,
            code,
            redirectUri: state.redirectUri,
            codeVerifier: state.codeVerifier,
        }).catch(async (error: unknown) => {
            deps.warn(`フェディバースのトークンを受け取れませんでした: ${server.host}`, error);
            // 相手のサーバーでアプリが消された（トークンの口がクライアントを認めない）ときだけ、次は登録し直す
            if (error instanceof HttpStatusError && error.status === 401) {
                await deps.clients.forget(server.origin, state.redirectUri);
            }
            return null;
        });
        if (!token) return null;
        try {
            return await fetchMastodonAccount(deps.http, server, token);
        } catch (error) {
            deps.warn(`フェディバースの本人の情報を受け取れませんでした: ${server.host}`, error);
            return null;
        } finally {
            await revokeMastodonToken(deps.http, server, { client, token }).catch((error: unknown) =>
                deps.warn(`トークンを失効できませんでした: ${server.host}`, error),
            );
        }
    };

    const appOriginOf = (origin: string | null): string =>
        origin && deps.isAppOrigin(origin) ? origin : deps.config.defaultAppOrigin;

    const lookupCache = createLookupCache({ ttlMs: 5 * 60 * 1000, max: 500, now: () => deps.now().getTime() });

    return {
        /** 選んだサーバーの公開情報（名前・アイコン・種類）。ログインに使えるかもここで分かる。 */
        lookup(input: string): Promise<LookupOutcome> {
            const parsed = parseServer(input);
            if (!parsed.ok) return Promise.resolve({ ok: false, error: 'invalid-server' });
            // 書き方の違い（大文字・https:// 付き）で覚えた結果を外させない
            return lookupCache(parsed.host, () =>
                lookupFediverseServer(parsed.host, {
                    http: deps.http,
                    discover,
                    serverAllowed,
                    enabled: deps.config.enabled,
                }),
            );
        },

        async start(input: {
            server: string;
            intent: FediverseSignInIntent;
            prefer?: 'sign-in' | 'sign-up';
            returnTo: unknown;
            origin: string | null;
            /** link のときのログイン中のユーザーとセッション */
            session: { userId: string; sessionId: string } | null;
        }): Promise<StartOutcome> {
            if (!deps.config.enabled) return { ok: false, error: 'disabled' };
            const parsed = parseServer(input.server);
            if (!parsed.ok) return { ok: false, error: 'invalid-server' };
            if (!(await serverAllowed(parsed.host))) return { ok: false, error: 'server-not-allowed' };
            if (input.intent === 'link' && !input.session) return { ok: false, error: 'session-changed' };
            if (input.session && !(await deps.accounts.ssoAllowedFor(input.session.userId))) {
                return { ok: false, error: 'not-allowed-for-account' };
            }
            const server = await discover(parsed.host);
            if (server === 'unsupported') return { ok: false, error: 'unsupported-server' };
            if (server === 'unreachable') return { ok: false, error: 'server-unreachable' };
            const redirectUri = callbackUrlFor(server.host);
            const client =
                server.software === 'mastodon'
                    ? await clientFor(server, redirectUri).catch((error: unknown) => {
                          deps.warn(`アプリを登録できません: ${server.host}`, error);
                          return null;
                      })
                    : null;
            if (server.software === 'mastodon' && !client) return { ok: false, error: 'server-unreachable' };

            // Mastodon は state、Misskey は MiAuth のセッション ID。どちらも推測できない一度だけの鍵
            const key = deps.random();
            const codeVerifier = server.software === 'mastodon' ? deps.random() : '';
            const browserToken = deps.random();
            const stored: FlowState = {
                server,
                clientId: client?.clientId ?? '',
                redirectUri,
                codeVerifier,
                browserHash: hash(browserToken),
                intent: input.intent,
                prefer: input.prefer ?? 'sign-in',
                returnTo: safeReturnTo(input.returnTo),
                appOrigin: appOriginOf(input.origin),
                link: input.intent === 'link' ? input.session : null,
            };
            const now = deps.now();
            await deps.flows.put(
                `${STATE_PREFIX}${hash(key)}`,
                JSON.stringify(stored),
                new Date(now.getTime() + STATE_TTL_MS),
                deps.random(),
            );
            const icon = `${deps.config.website.replace(/\/+$/, '')}/icon.png`;
            const authorizationUrl =
                server.software === 'misskey'
                    ? miAuthUrl(server, { session: key, callback: redirectUri, name: 'Ubichill', icon })
                    : client
                      ? mastodonAuthorizationUrl(server, {
                            clientId: client.clientId,
                            redirectUri,
                            state: key,
                            codeChallenge: hash(codeVerifier),
                        })
                      : null;
            if (!authorizationUrl) return { ok: false, error: 'server-unreachable' };
            return { ok: true, browserToken, authorizationUrl };
        },

        async callback(input: {
            /** 戻り先 URL のパスに入れたホスト */
            server: string;
            /** Mastodon は code・state・iss・error、Misskey（MiAuth）は session */
            query: { code?: string; state?: string; iss?: string; error?: string; session?: string };
            /** 開始時にブラウザーへ渡した値（クッキー） */
            browserToken: string | null;
            /** いまのセッション（link のときに開始時と同じか確かめる） */
            sessionId: string | null;
        }): Promise<CallbackOutcome> {
            const now = deps.now();
            // state の中身（戻り先の origin）は、このブラウザーが始めたと確かめた後にだけ使う。それより前の失敗は
            // 既定の画面に戻す（他人が始めた state で、任意の origin へ飛ばさせない）
            const fail = (error: FediverseSignInError, state?: FlowState): CallbackOutcome => {
                const appOrigin = state?.appOrigin ?? deps.config.defaultAppOrigin;
                const path = state?.intent === 'link' ? state.returnTo : '/auth';
                return { kind: 'error', error, redirectTo: `${appOrigin}${withQuery(path, 'fediverse_error', error)}` };
            };
            // state と session の両方が付いた応答は受け付けない（どちらの流れの鍵かを曖昧にしない）
            const key = input.query.state ?? input.query.session;
            if (!key || (input.query.state && input.query.session)) return fail('mismatch');
            const state = readJson(StateSchema, await deps.flows.take(`${STATE_PREFIX}${hash(key)}`, now));
            if (!state) return fail('expired');
            // Mastodon の state で Misskey の流れを（またはその逆を）進めさせない
            const keyKind = input.query.state ? 'mastodon' : 'misskey';
            if (state.server.software !== keyKind) return fail('mismatch');
            // 開始の後に止められたら、応答が来ても続けない
            if (!deps.config.enabled) return fail('disabled', state);
            if (!input.browserToken || hash(input.browserToken) !== state.browserHash) return fail('mismatch');
            if (input.server !== state.server.host) return fail('mismatch', state);
            if (input.query.error) return fail(input.query.error === 'access_denied' ? 'denied' : 'failed', state);
            // 発行元（RFC 9207）が付いていれば照合する
            if (
                state.server.software === 'mastodon' &&
                input.query.iss !== undefined &&
                input.query.iss !== state.server.issuer
            ) {
                return fail('mismatch', state);
            }
            if (state.server.software === 'mastodon' && !input.query.code) return fail('failed', state);
            if (!(await serverAllowed(state.server.host))) return fail('server-not-allowed', state);
            if (state.intent === 'link' && state.link?.sessionId !== input.sessionId)
                return fail('session-changed', state);

            const server: AuthorizationServer = state.server;
            const account =
                server.software === 'mastodon'
                    ? await mastodonAccount(state, server, input.query.code ?? '')
                    : await checkMiAuth(deps.http, server, key).catch((error: unknown) => {
                          deps.warn(`MiAuth を確かめられませんでした: ${server.host}`, error);
                          return null;
                      });
            if (!account) return fail('server-error', state);

            const identity: ExternalIdentity = {
                providerId: fediverseProviderId(server.origin),
                accountId: account.id,
                software: server.software,
                username: account.username,
            };
            const back = `${state.appOrigin}${state.returnTo}`;

            if (state.intent === 'link' && state.link) {
                if (!(await deps.accounts.ssoAllowedFor(state.link.userId)))
                    return fail('not-allowed-for-account', state);
                const linked = await deps.accounts.link({
                    userId: state.link.userId,
                    accountRowId: deps.newId('account'),
                    identity,
                    now,
                });
                if (linked.status === 'linked-to-other') return fail('linked-to-other', state);
                if (linked.status === 'linked') {
                    await deps
                        .notifyLinked(state.link.userId, `@${identity.username}@${server.host}`)
                        .catch((error: unknown) => deps.warn('ログイン方法の追加を知らせられませんでした', error));
                }
                return {
                    kind: 'linked',
                    redirectTo: `${state.appOrigin}${withQuery(state.returnTo, 'fediverse', 'linked')}`,
                };
            }

            const existing = await deps.accounts.findUserByIdentity(identity, now);
            if (existing && !(await deps.accounts.ssoAllowedFor(existing.userId))) {
                return fail('not-allowed-for-account', state);
            }
            if (existing) {
                // 新規登録を押したが登録済みだった。そのままログインし、画面で知らせる
                const redirectTo =
                    state.prefer === 'sign-up'
                        ? `${state.appOrigin}${withQuery(state.returnTo, 'fediverse', 'already-registered')}`
                        : back;
                return { kind: 'signed-in', ...existing, redirectTo };
            }

            const ticket = deps.random();
            const pending: SignUpTicket = {
                identity,
                host: server.host,
                displayName: account.displayName,
                returnTo: state.returnTo,
                notRegistered: state.prefer === 'sign-in',
            };
            await deps.flows.put(
                `${SIGN_UP_PREFIX}${hash(ticket)}`,
                JSON.stringify(pending),
                new Date(now.getTime() + SIGN_UP_TTL_MS),
                deps.random(),
            );
            return {
                kind: 'sign-up',
                ticket,
                redirectTo: `${state.appOrigin}${withQuery('/auth', 'fediverse', 'sign-up')}`,
            };
        },

        async signUpCandidate(ticket: string | null): Promise<FediverseSignUpCandidate | null> {
            if (!ticket || !deps.config.enabled) return null;
            const pending = readJson(
                SignUpSchema,
                await deps.flows.peek(`${SIGN_UP_PREFIX}${hash(ticket)}`, deps.now()),
            );
            if (!pending) return null;
            return {
                server: pending.host,
                username: pending.identity.username,
                handle: handleCandidateOf(pending.identity.username),
                displayName: displayNameCandidateOf(pending.displayName, pending.identity.username),
                notRegistered: pending.notRegistered,
                registrationOpen: deps.registrationOpen(),
            };
        },

        /** 登録をやめる（共用の端末で、別の人が続きから登録できないように消す）。 */
        async cancelSignUp(ticket: string | null): Promise<void> {
            if (ticket) await deps.flows.remove(`${SIGN_UP_PREFIX}${hash(ticket)}`);
        },

        async signUp(input: { ticket: string | null; handle: unknown; displayName: unknown }): Promise<SignUpOutcome> {
            const now = deps.now();
            const identifier = `${SIGN_UP_PREFIX}${hash(input.ticket ?? '')}`;
            const pending = input.ticket ? readJson(SignUpSchema, await deps.flows.peek(identifier, now)) : undefined;
            if (!pending) {
                return { ok: false, status: 404, error: '登録の期限が切れました。もう一度ログインしてください' };
            }
            // 停止・接続先の許可は、既存ユーザーとしてログインさせる分岐より前に確かめる（確定の時点の設定で判定する）
            if (!deps.config.enabled)
                return { ok: false, status: 400, error: 'フェディバースでのログインは無効になっています' };
            if (!(await serverAllowed(pending.host))) {
                return { ok: false, status: 400, error: 'このサーバーのアカウントでは登録できません' };
            }
            const existing = await deps.accounts.findUserByIdentity(pending.identity, now);
            if (existing && !(await deps.accounts.ssoAllowedFor(existing.userId))) {
                return { ok: false, status: 400, error: 'このアカウントはフェディバースでのログインに使えません' };
            }
            if (existing) {
                await deps.flows.remove(identifier);
                return { ok: true, ...existing, returnTo: pending.returnTo };
            }
            if (!deps.registrationOpen()) {
                return { ok: false, status: 400, error: '現在、新規登録を受け付けていません' };
            }
            const recent = await deps.accounts.countLinkedSince(
                pending.identity.providerId,
                new Date(now.getTime() - 60 * 60 * 1000),
            );
            if (recent >= deps.config.signUpsPerServerPerHour) {
                return { ok: false, status: 400, error: FEDIVERSE_SIGN_IN_ERRORS['too-many-sign-ups'] };
            }
            const handle = deps.validate.handle.safeParse(typeof input.handle === 'string' ? input.handle.trim() : '');
            if (!handle.success)
                return { ok: false, status: 400, error: handle.error.issues[0]?.message ?? 'ID が不正です' };
            const name = deps.validate.displayName.safeParse(input.displayName);
            if (!name.success) {
                return { ok: false, status: 400, error: name.error.issues[0]?.message ?? '表示名が不正です' };
            }
            const userId = deps.newId('user');
            const accountRowId = deps.newId('account');
            const created = await deps.accounts.createUser({
                userId,
                accountRowId,
                email: placeholderEmail(deps.random().replace(/[^a-zA-Z0-9]/g, '')),
                name: name.data,
                handle: handle.data,
                displayNameKey: displayNameKey(name.data),
                identity: pending.identity,
                now,
            });
            switch (created.status) {
                case 'created':
                    await deps.flows.remove(identifier);
                    return { ok: true, userId, accountRowId, returnTo: pending.returnTo };
                case 'identity-taken':
                    await deps.flows.remove(identifier);
                    return {
                        ok: true,
                        userId: created.userId,
                        accountRowId: created.accountRowId,
                        returnTo: pending.returnTo,
                    };
                case 'handle-taken':
                    return { ok: false, status: 409, error: 'この ID は既に使用されています' };
                case 'name-taken':
                    return { ok: false, status: 409, error: 'この表示名は既に使用されています' };
            }
        },
    };
}

export type FediverseSignIn = ReturnType<typeof createFediverseSignIn>;
