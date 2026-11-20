/**
 * ログインに使えるサーバーかと、その種類を決める。バージョン文字列ではなく、実際に備えるもので判定する。
 *
 * - Mastodon（4.3 以降）: OAuth の公開メタデータ（RFC 8414）に、アプリ登録（app_registration_endpoint）・
 *   `profile` の権限・PKCE S256 がある。OAuth でログインする
 * - Misskey 系: nodeinfo のソフトウェア名が Misskey 系。MiAuth でログインする。Misskey の OAuth は同意の途中の
 *   状態をプロセスのメモリにしか持たず、複数台で動くサーバー（misskey.io など）では失敗する
 *   （misskey-dev/misskey#13088）。MiAuth は DB に置くので台数によらず動く
 */
import { NODEINFO_SCHEMA, readNodeInfo } from '@ubichill/shared';
import { z } from 'zod';

export interface MastodonServer {
    software: 'mastodon';
    host: string;
    /** 認証サーバーの origin（`https://host`）。外部アカウントのキーに使う */
    origin: string;
    /** メタデータの issuer そのまま（応答に `iss` が付いていれば完全一致で照合する） */
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint: string | null;
    registrationEndpoint: string;
}

export interface MisskeyServer {
    software: 'misskey';
    host: string;
    origin: string;
}

export type AuthorizationServer = MastodonServer | MisskeyServer;

/** MiAuth を備える Misskey とその派生（nodeinfo の software.name）。 */
export const MISSKEY_FAMILY: ReadonlySet<string> = new Set(['misskey', 'sharkey', 'cherrypick']);

const MetadataSchema = z.object({
    issuer: z.string(),
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    revocation_endpoint: z.string().optional(),
    app_registration_endpoint: z.string().optional(),
    scopes_supported: z.array(z.string()).default([]),
    code_challenge_methods_supported: z.array(z.string()).default([]),
    response_types_supported: z.array(z.string()).default([]),
});

/** https で、認証サーバーと同じ origin の URL だけ通す（メタデータで別のホストへ資格情報を送らせない）。 */
function sameOriginUrl(raw: string | undefined, origin: string): string | null {
    if (!raw) return null;
    const url = URL.parse(raw);
    return url && url.protocol === 'https:' && url.origin === origin ? url.href : null;
}

/** OAuth のメタデータが Mastodon のログインに使えるものなら、そのサーバー。使えなければ null。 */
export function readMastodonServer(host: string, metadata: unknown): MastodonServer | null {
    const parsed = MetadataSchema.safeParse(metadata);
    if (!parsed.success) return null;
    const m = parsed.data;
    const origin = `https://${host}`;
    const authorizationEndpoint = sameOriginUrl(m.authorization_endpoint, origin);
    const tokenEndpoint = sameOriginUrl(m.token_endpoint, origin);
    const registrationEndpoint = sameOriginUrl(m.app_registration_endpoint, origin);
    const supportsCodeFlow =
        m.code_challenge_methods_supported.includes('S256') &&
        (m.response_types_supported.length === 0 || m.response_types_supported.includes('code'));
    if (
        URL.parse(m.issuer)?.origin !== origin ||
        !authorizationEndpoint ||
        !tokenEndpoint ||
        !registrationEndpoint ||
        !supportsCodeFlow ||
        !m.scopes_supported.includes('profile')
    ) {
        return null;
    }
    return {
        software: 'mastodon',
        host,
        origin,
        issuer: m.issuer,
        authorizationEndpoint,
        tokenEndpoint,
        revocationEndpoint: sameOriginUrl(m.revocation_endpoint, origin),
        registrationEndpoint,
    };
}

/** `/.well-known/nodeinfo` から、同じ origin の https の nodeinfo の文書の URL を取り出す。 */
export function nodeInfoDocumentUrl(host: string, wellKnown: unknown): string | null {
    const parsed = z.object({ links: z.array(z.object({ rel: z.string(), href: z.string() })) }).safeParse(wellKnown);
    if (!parsed.success) return null;
    // 2.1 を優先し、無ければ 2.0
    const href =
        parsed.data.links.find((l) => l.rel === NODEINFO_SCHEMA)?.href ??
        parsed.data.links.find((l) => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.0')?.href;
    return sameOriginUrl(href, `https://${host}`);
}

/** nodeinfo の文書が Misskey 系なら、そのサーバー。 */
export function readMisskeyServer(host: string, nodeInfo: unknown): MisskeyServer | null {
    const summary = readNodeInfo(nodeInfo);
    return summary && MISSKEY_FAMILY.has(summary.software)
        ? { software: 'misskey', host, origin: `https://${host}` }
        : null;
}
