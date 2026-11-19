/**
 * Mastodon・Misskey の OAuth の要求（アプリ登録・認可 URL・トークン交換・本人の取得・失効）。HTTP は注入する
 * （本番は safeFetch でリダイレクトを追わない。資格情報を別の宛先へ送らないため）。
 */
import { z } from 'zod';
import type { AuthorizationServer } from './discovery';

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
    /** Mastodon だけ（Misskey は公開クライアント） */
    clientSecret: string | null;
}

export interface ExternalAccount {
    id: string;
    username: string;
    displayName: string | null;
}

const SCOPE: Record<AuthorizationServer['software'], string> = {
    mastodon: 'profile',
    misskey: 'read:account',
};

const form = (params: Record<string, string>) => ({
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

const AppSchema = z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) });
const TokenSchema = z.object({ access_token: z.string().min(1) });
// 外部サーバーの応答は信用しない。ID とユーザー名は DB・通知メールに入るので形と長さを限る
const ExternalIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const ExternalUsernameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const ExternalNameSchema = z
    .string()
    .nullish()
    .transform((v) => (v ? v.slice(0, 200) : v));
const MastodonAccountSchema = z.object({
    id: ExternalIdSchema,
    username: ExternalUsernameSchema,
    display_name: ExternalNameSchema,
});
const MisskeyAccountSchema = z.object({
    id: ExternalIdSchema,
    username: ExternalUsernameSchema,
    name: ExternalNameSchema,
    // 他サーバーのユーザーなら host が入る（自分のサーバーの本人なら null）
    host: z.string().nullish(),
});

/** Mastodon にアプリを登録する（認証サーバーと戻り先 URL ごとに 1 回）。 */
export async function registerMastodonApp(
    http: FediverseHttp,
    server: AuthorizationServer,
    input: { redirectUri: string; clientName: string; website: string },
): Promise<{ clientId: string; clientSecret: string }> {
    if (!server.registrationEndpoint) throw new Error('アプリ登録の口がありません');
    const app = AppSchema.parse(
        await http.json(server.registrationEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_name: input.clientName,
                redirect_uris: [input.redirectUri],
                scopes: SCOPE.mastodon,
                website: input.website,
            }),
        }),
    );
    return { clientId: app.client_id, clientSecret: app.client_secret };
}

export function authorizationUrl(
    server: AuthorizationServer,
    input: { clientId: string; redirectUri: string; state: string; codeChallenge: string },
): string {
    const url = new URL(server.authorizationEndpoint);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        scope: SCOPE[server.software],
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
    }).toString();
    return url.href;
}

export async function exchangeCode(
    http: FediverseHttp,
    server: AuthorizationServer,
    input: { client: ClientCredentials; code: string; redirectUri: string; codeVerifier: string },
): Promise<string> {
    const params: Record<string, string> = {
        grant_type: 'authorization_code',
        code: input.code,
        client_id: input.client.clientId,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
        ...(input.client.clientSecret ? { client_secret: input.client.clientSecret } : {}),
    };
    const token = TokenSchema.parse(await http.json(server.tokenEndpoint, { method: 'POST', ...form(params) }));
    return token.access_token;
}

export async function fetchAccount(
    http: FediverseHttp,
    server: AuthorizationServer,
    accessToken: string,
): Promise<ExternalAccount> {
    if (server.software === 'mastodon') {
        const account = MastodonAccountSchema.parse(
            await http.json(`${server.origin}/api/v1/accounts/verify_credentials`, {
                method: 'GET',
                headers: bearer(accessToken),
            }),
        );
        return { id: account.id, username: account.username, displayName: account.display_name ?? null };
    }
    const account = MisskeyAccountSchema.parse(
        await http.json(`${server.origin}/api/i`, {
            method: 'POST',
            headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
            body: '{}',
        }),
    );
    if (account.host) throw new Error('本人の情報に別のサーバーのユーザーが返りました');
    return { id: account.id, username: account.username, displayName: account.name ?? null };
}

/** 本人の確認に使ったトークンを失効させる（失効の口を持つサーバーだけ。失敗してもログインは止めない）。 */
export async function revokeToken(
    http: FediverseHttp,
    server: AuthorizationServer,
    input: { client: ClientCredentials; token: string },
): Promise<boolean> {
    if (!server.revocationEndpoint) return false;
    await http.json(server.revocationEndpoint, {
        method: 'POST',
        ...form({
            client_id: input.client.clientId,
            ...(input.client.clientSecret ? { client_secret: input.client.clientSecret } : {}),
            token: input.token,
        }),
    });
    return true;
}
