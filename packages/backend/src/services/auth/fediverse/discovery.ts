/**
 * 認証サーバーの公開メタデータ（RFC 8414 `/.well-known/oauth-authorization-server`）から、ログインに使えるサーバーか
 * と種類を決める。Mastodon 4.3 以降・Misskey 2023.9.0 以降が返す。バージョン文字列ではなく、実際に備えるもので判定する。
 *
 * - Mastodon: アプリ登録（app_registration_endpoint）と `profile` の権限がある
 * - Misskey 系: `read:account` の権限と、認可応答の `iss`（RFC 9207）がある
 */
import type { FediverseSoftware } from '@ubichill/shared';
import { z } from 'zod';

export interface AuthorizationServer {
    software: FediverseSoftware;
    host: string;
    /** 認証サーバーの origin（`https://host`）。外部アカウントのキーに使う */
    origin: string;
    /** メタデータの issuer そのまま（Misskey の `iss` と完全一致で照合する） */
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint: string | null;
    registrationEndpoint: string | null;
}

const MetadataSchema = z.object({
    issuer: z.string(),
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    revocation_endpoint: z.string().optional(),
    app_registration_endpoint: z.string().optional(),
    scopes_supported: z.array(z.string()).default([]),
    code_challenge_methods_supported: z.array(z.string()).default([]),
    response_types_supported: z.array(z.string()).default([]),
    authorization_response_iss_parameter_supported: z.boolean().optional(),
});

export type DiscoveryResult = { ok: true; server: AuthorizationServer } | { ok: false; reason: 'unsupported' };

/** https で、認証サーバーと同じ origin の URL だけ通す（メタデータで別のホストへ資格情報を送らせない）。 */
function sameOriginUrl(raw: string | undefined, origin: string): string | null {
    if (!raw) return null;
    const url = URL.parse(raw);
    return url && url.protocol === 'https:' && url.origin === origin ? url.href : null;
}

export function readAuthorizationServer(host: string, metadata: unknown): DiscoveryResult {
    const parsed = MetadataSchema.safeParse(metadata);
    if (!parsed.success) return { ok: false, reason: 'unsupported' };
    const m = parsed.data;
    const origin = `https://${host}`;
    const issuerUrl = URL.parse(m.issuer);
    const authorizationEndpoint = sameOriginUrl(m.authorization_endpoint, origin);
    const tokenEndpoint = sameOriginUrl(m.token_endpoint, origin);
    const supportsCodeFlow =
        m.code_challenge_methods_supported.includes('S256') &&
        (m.response_types_supported.length === 0 || m.response_types_supported.includes('code'));
    if (issuerUrl?.origin !== origin || !authorizationEndpoint || !tokenEndpoint || !supportsCodeFlow) {
        return { ok: false, reason: 'unsupported' };
    }
    const registrationEndpoint = sameOriginUrl(m.app_registration_endpoint, origin);
    const base = {
        host,
        origin,
        issuer: m.issuer,
        authorizationEndpoint,
        tokenEndpoint,
        revocationEndpoint: sameOriginUrl(m.revocation_endpoint, origin),
    };
    if (registrationEndpoint && m.scopes_supported.includes('profile')) {
        return { ok: true, server: { ...base, software: 'mastodon', registrationEndpoint } };
    }
    if (m.scopes_supported.includes('read:account') && m.authorization_response_iss_parameter_supported === true) {
        return { ok: true, server: { ...base, software: 'misskey', registrationEndpoint: null } };
    }
    return { ok: false, reason: 'unsupported' };
}
