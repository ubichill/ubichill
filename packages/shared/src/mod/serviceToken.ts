/**
 * サービストークン — mod が外部サービスへ「Ubichill にログインしている利用者からの依頼」であることを示す短命の署名。
 *
 * 形式は標準の JWT（alg: EdDSA / Ed25519）。外部サービスは発行元の公開鍵（JWKS）と既存の JWT ライブラリで検証でき、
 * 共有の秘密も事前登録も要らない。どの Ubichill も発行元になれ、信頼する発行元はサービス側が決める。
 *
 * - `aud` はサービスのオリジン。トークンはそのサービスでしか通らない。
 * - `sub` はサービスごとの仮名。本当のユーザー ID は渡さず、サービスをまたいで同じ人だと突き合わせられない。
 *
 * ここは形式と規則（純粋な知識）だけを持つ。署名は発行元（backend）が行う。
 */

/** トークンの有効期間（秒）。漏れても使える時間を短くする。 */
export const SERVICE_TOKEN_TTL_SECONDS = 300;

/** 発行元のオリジンからの、公開鍵（JWKS）の置き場所。 */
export const SERVICE_TOKEN_KEYS_PATH = '/api/v1/service-tokens/keys';

export const SERVICE_TOKEN_ALGORITHM = 'EdDSA';

export interface ServiceTokenClaims {
    /** 発行元（Ubichill の公開オリジン）。 */
    iss: string;
    /** 宛先のサービスのオリジン。 */
    aud: string;
    /** サービスごとの利用者の仮名。 */
    sub: string;
    /** 依頼した mod の ID（mod.json の id）。 */
    mod: string;
    iat: number;
    exp: number;
    /** トークンごとの一意な値（サービスが再利用を検出したい場合に使う）。 */
    jti: string;
}

/** JWKS の 1 件（Ed25519 の公開鍵）。 */
export interface ServiceTokenJwk {
    kty: 'OKP';
    crv: 'Ed25519';
    x: string;
    kid: string;
    alg: typeof SERVICE_TOKEN_ALGORITHM;
    use: 'sig';
}

export function serviceTokenKeysUrl(issuer: string): string {
    return `${issuer}${SERVICE_TOKEN_KEYS_PATH}`;
}

/**
 * 宛先を正規化してオリジンを返す。https のオリジン（パス・クエリ・認証情報なし）だけを受け付け、
 * 開発用に localhost / 127.0.0.1 の http も許す。既定のポートは省く。それ以外は null。
 * ホスト名は ASCII（国際化ドメインは punycode）に限る。
 */
export function normalizeServiceAudience(input: string): string | null {
    const match = /^(https?):\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?$/.exec(input);
    if (!match) return null;
    const scheme = match[1] as 'http' | 'https';
    const host = (match[2] ?? '').toLowerCase();
    if (host === '' || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (scheme === 'http' && !isLocal) return null;
    const port = match[3] === undefined ? undefined : Number(match[3]);
    if (port !== undefined && (port < 1 || port > 65535)) return null;
    const defaultPort = scheme === 'https' ? 443 : 80;
    return port === undefined || port === defaultPort ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

export type ServiceTokenRejectReason =
    | 'malformed'
    | 'unsupported-algorithm'
    | 'untrusted-issuer'
    | 'unknown-key'
    | 'bad-signature'
    | 'wrong-audience'
    | 'expired'
    | 'not-yet-valid'
    | 'mod-not-allowed';

export function isServiceTokenClaims(value: unknown): value is ServiceTokenClaims {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        ['iss', 'aud', 'sub', 'mod', 'jti'].every((key) => typeof v[key] === 'string') &&
        Number.isFinite(v.iat) &&
        Number.isFinite(v.exp)
    );
}

export interface ServiceTokenClaimRules {
    /** このサービス自身のオリジン。 */
    audience: string;
    /** 現在時刻（秒）。 */
    now: number;
    /** 受け付ける mod の ID。省略時は問わない。 */
    allowedMods?: readonly string[];
    /** 時計のずれの許容（秒）。 */
    clockSkewSeconds?: number;
}

/** 署名を確かめた後に、宛先・期限・mod を確かめる（サービス側の規則）。 */
export function checkServiceTokenClaims(
    claims: ServiceTokenClaims,
    rules: ServiceTokenClaimRules,
): ServiceTokenRejectReason | null {
    const skew = rules.clockSkewSeconds ?? 30;
    if (claims.aud !== rules.audience) return 'wrong-audience';
    if (claims.exp + skew <= rules.now) return 'expired';
    if (claims.iat - skew > rules.now) return 'not-yet-valid';
    if (rules.allowedMods && !rules.allowedMods.includes(claims.mod)) return 'mod-not-allowed';
    return null;
}
