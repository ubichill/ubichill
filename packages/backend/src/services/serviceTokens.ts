/**
 * サービストークンの発行（形式と検証は @ubichill/shared の serviceToken）。
 *
 * - 署名鍵は env SERVICE_TOKEN_SIGNING_KEY（Ed25519 の PKCS8。PEM か base64）。複数 Pod でも同じ鍵を使う。
 *   本番で未設定なら発行しない。開発では起動ごとに使い捨ての鍵を作る。
 * - 仮名（sub）は BETTER_AUTH_SECRET から導いた秘密で作る。署名鍵を差し替えても仮名は変わらない。
 */
import {
    createHash,
    createHmac,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    type KeyObject,
    randomBytes,
    sign,
} from 'node:crypto';
import {
    SERVICE_TOKEN_ALGORITHM,
    SERVICE_TOKEN_TTL_SECONDS,
    type ServiceTokenClaims,
    type ServiceTokenJwk,
} from '@ubichill/shared';

export interface IssuedServiceToken {
    token: string;
    /** 期限（ミリ秒の epoch）。 */
    expiresAt: number;
}

export interface ServiceTokenIssuer {
    readonly issuer: string;
    issue(input: { userId: string; audience: string; modId: string }): IssuedServiceToken;
    jwks(): { keys: ServiceTokenJwk[] };
}

export interface ServiceTokenIssuerOptions {
    issuer: string;
    privateKeyPkcs8: Uint8Array;
    subjectSecret: string;
    now?: () => number;
    randomId?: () => string;
}

/** サービスごとの仮名。同じ人・同じサービスなら常に同じで、サービスが違えば突き合わせられない。 */
export function servicePseudonym(subjectSecret: string, audience: string, userId: string): string {
    return createHmac('sha256', subjectSecret)
        .update(`ubichill/service-token/subject\n${audience}\n${userId}`)
        .digest('base64url');
}

/** 公開鍵（JWK の x）から kid を作る。鍵を差し替えたらサービス側が新しい鍵を取り直せるように。 */
export function serviceTokenKeyId(publicKeyX: string): string {
    return createHash('sha256').update(Buffer.from(publicKeyX, 'base64url')).digest('base64url').slice(0, 16);
}

const encodeJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function signServiceToken(claims: ServiceTokenClaims, privateKey: KeyObject, kid: string): string {
    const signingInput = `${encodeJson({ alg: SERVICE_TOKEN_ALGORITHM, typ: 'JWT', kid })}.${encodeJson(claims)}`;
    return `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString('base64url')}`;
}

export function createServiceTokenIssuer(options: ServiceTokenIssuerOptions): ServiceTokenIssuer {
    const privateKey = createPrivateKey({ key: Buffer.from(options.privateKeyPkcs8), format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ed25519')
        throw new Error('サービストークンの署名鍵は Ed25519 にしてください');
    const { x } = createPublicKey(privateKey).export({ format: 'jwk' });
    if (!x) throw new Error('サービストークンの署名鍵から公開鍵を導出できません');
    const kid = serviceTokenKeyId(x);
    const jwk: ServiceTokenJwk = { kty: 'OKP', crv: 'Ed25519', x, kid, alg: SERVICE_TOKEN_ALGORITHM, use: 'sig' };
    const now = options.now ?? Date.now;
    const randomId = options.randomId ?? (() => randomBytes(16).toString('base64url'));

    return {
        issuer: options.issuer,
        issue({ userId, audience, modId }) {
            const iat = Math.floor(now() / 1000);
            const exp = iat + SERVICE_TOKEN_TTL_SECONDS;
            const token = signServiceToken(
                {
                    iss: options.issuer,
                    aud: audience,
                    sub: servicePseudonym(options.subjectSecret, audience, userId),
                    mod: modId,
                    iat,
                    exp,
                    jti: randomId(),
                },
                privateKey,
                kid,
            );
            return { token, expiresAt: exp * 1000 };
        },
        jwks: () => ({ keys: [jwk] }),
    };
}

/** PEM（-----BEGIN PRIVATE KEY-----）か base64 の PKCS8 を DER に戻す。 */
export function parsePkcs8(text: string): Uint8Array {
    const body = text.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    return Uint8Array.from(Buffer.from(body, 'base64'));
}

export type ServiceTokenKeySource =
    | { kind: 'configured'; pkcs8: Uint8Array }
    | { kind: 'ephemeral' }
    | { kind: 'disabled' };

/** どの鍵で発行するかを env から決める（本番で未設定なら発行しない）。 */
export function serviceTokenKeySource(env: NodeJS.ProcessEnv): ServiceTokenKeySource {
    const configured = env.SERVICE_TOKEN_SIGNING_KEY?.trim();
    if (configured) return { kind: 'configured', pkcs8: parsePkcs8(configured) };
    return env.NODE_ENV === 'production' ? { kind: 'disabled' } : { kind: 'ephemeral' };
}

function generatePkcs8(): Uint8Array {
    return generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' });
}

/** env から発行器を作る。発行しない設定なら null。鍵が壊れていれば起動時に失敗させる。 */
export function serviceTokenIssuerFromEnv(
    env: NodeJS.ProcessEnv,
    issuer: string,
    warn: (message: string) => void = console.warn,
): ServiceTokenIssuer | null {
    const source = serviceTokenKeySource(env);
    if (source.kind === 'disabled') {
        warn('SERVICE_TOKEN_SIGNING_KEY が未設定のため、サービストークンを発行しません');
        return null;
    }
    if (source.kind === 'ephemeral') {
        warn(
            'SERVICE_TOKEN_SIGNING_KEY が未設定のため、起動ごとの使い捨ての鍵でサービストークンを発行します（開発用）',
        );
    }
    const subjectSecret = env.BETTER_AUTH_SECRET;
    if (!subjectSecret) throw new Error('サービストークンの仮名には BETTER_AUTH_SECRET が必要です');
    return createServiceTokenIssuer({
        issuer,
        privateKeyPkcs8: source.kind === 'configured' ? source.pkcs8 : generatePkcs8(),
        subjectSecret,
    });
}
