/**
 * ログインの要求。Mastodon は OAuth（アプリ登録・認可 URL・トークン交換・本人の取得・失効）、Misskey は MiAuth
 * （認可 URL・確認）。HTTP は注入する（本番は safeFetch でリダイレクトを追わない。資格情報を別の宛先へ送らないため）。
 */
import { z } from 'zod';
import type { MastodonServer, MisskeyServer } from './discovery';

export interface FediverseHttp {
    /** JSON を返す要求。2xx 以外は {@link HttpStatusError} を投げる */
    json(
        url: string,
        init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
    ): Promise<unknown>;
}

export class HttpStatusError extends Error {
    constructor(
        readonly status: number,
        url: string,
    ) {
        super(`HTTP ${status}: ${url}`);
    }
}

export interface ClientCredentials {
    clientId: string;
    clientSecret: string;
}

export interface ExternalAccount {
    id: string;
    username: string;
    displayName: string | null;
    /** 取り込んでよいアイコンの URL（https で、サーバーの初期アイコンでないもの） */
    avatarUrl: string | null;
}

/**
 * 外部のアイコンの URL のうち取り込むもの。https だけで、設定していない人に出す初期アイコン
 * （Mastodon の missing.png・Misskey の identicon）は取り込まない。
 */
export function importableAvatarUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const url = URL.parse(raw);
    if (url?.protocol !== 'https:') return null;
    if (/\/missing\.png$/.test(url.pathname) || url.pathname.startsWith('/identicon/')) return null;
    return url.href;
}

const MASTODON_SCOPE = 'profile';
const MISSKEY_PERMISSION = 'read:account';

const form = (params: Record<string, string>) => ({
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
});

// 外部サーバーの応答は信用しない。ID とユーザー名は DB・通知メールに入るので形と長さを限る
const ExternalIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const ExternalUsernameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const ExternalNameSchema = z
    .string()
    .nullish()
    .transform((v) => (v ? v.slice(0, 200) : v));

const AppSchema = z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) });
const TokenSchema = z.object({ access_token: z.string().min(1) });
const MastodonAccountSchema = z.object({
    id: ExternalIdSchema,
    username: ExternalUsernameSchema,
    display_name: ExternalNameSchema,
    // アイコンは見た目だけ。形が違ってもログインは止めず、取り込まないだけ（importableAvatarUrl）
    avatar: z.unknown().optional(),
});
const MiAuthCheckSchema = z.object({
    ok: z.literal(true),
    user: z.object({
        id: ExternalIdSchema,
        username: ExternalUsernameSchema,
        name: ExternalNameSchema,
        avatarUrl: z.unknown().optional(),
        // 他サーバーのユーザーなら host が入る（自分のサーバーの本人なら null）
        host: z.string().nullish(),
    }),
});

/** Mastodon にアプリを登録する（認証サーバーと戻り先 URL ごとに 1 回）。 */
export async function registerMastodonApp(
    http: FediverseHttp,
    server: MastodonServer,
    input: { redirectUri: string; clientName: string; website: string },
): Promise<ClientCredentials> {
    const app = AppSchema.parse(
        await http.json(server.registrationEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_name: input.clientName,
                redirect_uris: [input.redirectUri],
                scopes: MASTODON_SCOPE,
                website: input.website,
            }),
        }),
    );
    return { clientId: app.client_id, clientSecret: app.client_secret };
}

export function mastodonAuthorizationUrl(
    server: MastodonServer,
    input: { clientId: string; redirectUri: string; state: string; codeChallenge: string },
): string {
    const url = new URL(server.authorizationEndpoint);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        scope: MASTODON_SCOPE,
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
    }).toString();
    return url.href;
}

export async function exchangeMastodonCode(
    http: FediverseHttp,
    server: MastodonServer,
    input: { client: ClientCredentials; code: string; redirectUri: string; codeVerifier: string },
): Promise<string> {
    const token = TokenSchema.parse(
        await http.json(server.tokenEndpoint, {
            method: 'POST',
            ...form({
                grant_type: 'authorization_code',
                code: input.code,
                client_id: input.client.clientId,
                client_secret: input.client.clientSecret,
                redirect_uri: input.redirectUri,
                code_verifier: input.codeVerifier,
            }),
        }),
    );
    return token.access_token;
}

export async function fetchMastodonAccount(
    http: FediverseHttp,
    server: MastodonServer,
    accessToken: string,
): Promise<ExternalAccount> {
    const account = MastodonAccountSchema.parse(
        await http.json(`${server.origin}/api/v1/accounts/verify_credentials`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }),
    );
    return {
        id: account.id,
        username: account.username,
        displayName: account.display_name ?? null,
        avatarUrl: importableAvatarUrl(account.avatar),
    };
}

/** 本人の確認に使ったトークンを失効させる（失効の口を持つサーバーだけ。失敗してもログインは止めない）。 */
export async function revokeMastodonToken(
    http: FediverseHttp,
    server: MastodonServer,
    input: { client: ClientCredentials; token: string },
): Promise<void> {
    if (!server.revocationEndpoint) return;
    await http.json(server.revocationEndpoint, {
        method: 'POST',
        ...form({ client_id: input.client.clientId, client_secret: input.client.clientSecret, token: input.token }),
    });
}

/**
 * MiAuth の許可の画面の URL。セッション ID は推測できない値にし、Ubichill だけが知る（確認の口で一度だけ使える）。
 * 許可されると Misskey は `callback?session=<ID>` へ戻す。
 */
export function miAuthUrl(
    server: MisskeyServer,
    input: { session: string; callback: string; name: string; icon: string },
): string {
    const url = new URL(`${server.origin}/miauth/${encodeURIComponent(input.session)}`);
    url.search = new URLSearchParams({
        name: input.name,
        icon: input.icon,
        callback: input.callback,
        permission: MISSKEY_PERMISSION,
    }).toString();
    return url.href;
}

/**
 * MiAuth のセッションを確かめて本人を得る。Misskey はトークンを一度だけ返す（2 度目は ok: false）。
 * トークンは Ubichill では使わないので捨てる（MiAuth のトークンは外の口から失効できない）。
 */
export async function checkMiAuth(
    http: FediverseHttp,
    server: MisskeyServer,
    session: string,
): Promise<ExternalAccount> {
    const checked = MiAuthCheckSchema.parse(
        await http.json(`${server.origin}/api/miauth/${encodeURIComponent(session)}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: '{}',
        }),
    );
    if (checked.user.host) throw new Error('本人の情報に別のサーバーのユーザーが返りました');
    return {
        id: checked.user.id,
        username: checked.user.username,
        displayName: checked.user.name ?? null,
        avatarUrl: importableAvatarUrl(checked.user.avatarUrl),
    };
}
