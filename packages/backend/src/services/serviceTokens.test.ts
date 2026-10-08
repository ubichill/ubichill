import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import {
    checkServiceTokenClaims,
    isServiceTokenClaims,
    SERVICE_TOKEN_TTL_SECONDS,
    type ServiceTokenJwk,
} from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import {
    createServiceTokenIssuer,
    parsePkcs8,
    servicePseudonym,
    serviceTokenIssuerFromEnv,
    serviceTokenKeySource,
    signServiceToken,
} from './serviceTokens';

const ISSUER = 'https://ubichill.example';
const AUDIENCE = 'https://videoplayer.example';
const NOW_MS = 1_800_000_000_000;

function pkcs8Pem(): string {
    return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function issuer(pem = pkcs8Pem()) {
    return createServiceTokenIssuer({
        issuer: ISSUER,
        privateKeyPkcs8: parsePkcs8(pem),
        subjectSecret: 'auth-secret',
        now: () => NOW_MS,
        randomId: () => 'jti-fixed',
    });
}

/** 外部サービスと同じ手順の検証（JWKS の鍵で署名を確かめ、規則を当てる）。 */
function verifyLikeService(token: string, keys: readonly ServiceTokenJwk[], now = NOW_MS / 1000) {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return 'malformed';
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'EdDSA') return 'unsupported-algorithm';
    const jwk = keys.find((k) => k.kid === parsedHeader.kid);
    if (!jwk) return 'unknown-key';
    const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
    if (!verify(null, Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url'))) {
        return 'bad-signature';
    }
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!isServiceTokenClaims(claims)) return 'malformed';
    return checkServiceTokenClaims(claims, { audience: AUDIENCE, now }) ?? claims;
}

describe('createServiceTokenIssuer', () => {
    it('発行したトークンは公開している JWKS で検証でき、5 分で期限が切れる', () => {
        const tokens = issuer();
        const { token, expiresAt } = tokens.issue({ userId: 'user-1', audience: AUDIENCE, modId: 'video-player' });

        expect(verifyLikeService(token, tokens.jwks().keys)).toMatchObject({
            iss: ISSUER,
            aud: AUDIENCE,
            mod: 'video-player',
            jti: 'jti-fixed',
            exp: NOW_MS / 1000 + SERVICE_TOKEN_TTL_SECONDS,
        });
        expect(expiresAt).toBe(NOW_MS + SERVICE_TOKEN_TTL_SECONDS * 1000);
        expect(verifyLikeService(token, tokens.jwks().keys, NOW_MS / 1000 + SERVICE_TOKEN_TTL_SECONDS + 30)).toBe(
            'expired',
        );
    });

    it('本当のユーザー ID・メール等はトークンに入らない', () => {
        const { token } = issuer().issue({ userId: 'user-1', audience: AUDIENCE, modId: 'video-player' });
        const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
        expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'mod', 'sub']);
        expect(token).not.toContain('user-1');
        expect(claims.sub).not.toBe('user-1');
    });

    it('別の鍵で署名したトークン（発行元のなりすまし）は検証で落ちる', () => {
        const real = issuer();
        const forgedKey = generateKeyPairSync('ed25519').privateKey;
        const kid = real.jwks().keys[0]?.kid ?? '';
        const forged = signServiceToken(
            { iss: ISSUER, aud: AUDIENCE, sub: 's', mod: 'm', iat: NOW_MS / 1000, exp: NOW_MS / 1000 + 300, jti: 'j' },
            forgedKey,
            kid,
        );
        expect(verifyLikeService(forged, real.jwks().keys)).toBe('bad-signature');
    });

    it('中身を書き換えると署名で落ちる（sub を他人の仮名に差し替える等）', () => {
        const tokens = issuer();
        const [header, body, signature] = tokens
            .issue({ userId: 'u', audience: AUDIENCE, modId: 'm' })
            .token.split('.');
        const claims = JSON.parse(Buffer.from(body ?? '', 'base64url').toString());
        const tampered = Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url');
        expect(verifyLikeService(`${header}.${tampered}.${signature}`, tokens.jwks().keys)).toBe('bad-signature');
    });

    it('JWKS には公開鍵だけが載り、秘密鍵（d）は出ない', () => {
        const { keys } = issuer().jwks();
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
        expect(keys[0]).not.toHaveProperty('d');
        expect(keys[0]?.kid).toMatch(/^[A-Za-z0-9_-]{16}$/);
    });

    it('Ed25519 以外の鍵は受け付けない', () => {
        const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
            format: 'der',
            type: 'pkcs8',
        });
        expect(() => createServiceTokenIssuer({ issuer: ISSUER, privateKeyPkcs8: rsa, subjectSecret: 's' })).toThrow(
            'Ed25519',
        );
    });
});

describe('servicePseudonym', () => {
    it('同じ人・同じサービスなら毎回同じ（サービスは回数制限などに使える）', () => {
        expect(servicePseudonym('s', AUDIENCE, 'user-1')).toBe(servicePseudonym('s', AUDIENCE, 'user-1'));
    });

    it('サービスが違えば別の値（サービス同士で突き合わせられない）', () => {
        expect(servicePseudonym('s', AUDIENCE, 'user-1')).not.toBe(
            servicePseudonym('s', 'https://other.example', 'user-1'),
        );
    });

    it('人が違えば別の値。秘密を知らなければ ID から計算できない', () => {
        expect(servicePseudonym('s', AUDIENCE, 'user-1')).not.toBe(servicePseudonym('s', AUDIENCE, 'user-2'));
        expect(servicePseudonym('s', AUDIENCE, 'user-1')).not.toBe(servicePseudonym('other', AUDIENCE, 'user-1'));
    });

    it('署名鍵を差し替えても仮名は変わらない', () => {
        const sub = (tokens: ReturnType<typeof issuer>) =>
            JSON.parse(
                Buffer.from(
                    tokens.issue({ userId: 'user-1', audience: AUDIENCE, modId: 'm' }).token.split('.')[1] ?? '',
                    'base64url',
                ).toString(),
            ).sub;
        const a = issuer();
        const b = issuer();
        expect(a.jwks().keys[0]?.kid).not.toBe(b.jwks().keys[0]?.kid);
        expect(sub(a)).toBe(sub(b));
    });
});

describe('serviceTokenKeySource / serviceTokenIssuerFromEnv', () => {
    it('PEM と base64 の PKCS8 のどちらでも読める', () => {
        const pem = pkcs8Pem();
        const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, '');
        expect(parsePkcs8(pem)).toEqual(parsePkcs8(base64));
    });

    it('本番で鍵が無ければ発行しない（Pod ごとに別の鍵になるのを避ける）', () => {
        expect(serviceTokenKeySource({ NODE_ENV: 'production' })).toEqual({ kind: 'disabled' });
        const warn = vi.fn();
        expect(serviceTokenIssuerFromEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x' }, ISSUER, warn)).toBeNull();
        expect(warn).toHaveBeenCalled();
    });

    it('開発で鍵が無ければ使い捨ての鍵で発行する', () => {
        const tokens = serviceTokenIssuerFromEnv({ NODE_ENV: 'development', BETTER_AUTH_SECRET: 'x' }, ISSUER, vi.fn());
        expect(tokens?.jwks().keys).toHaveLength(1);
    });

    it('設定した鍵で発行し、同じ鍵なら kid も同じ（複数 Pod で揃う）', () => {
        const pem = pkcs8Pem();
        const env = { SERVICE_TOKEN_SIGNING_KEY: pem, BETTER_AUTH_SECRET: 'x', NODE_ENV: 'production' };
        const a = serviceTokenIssuerFromEnv(env, ISSUER, vi.fn());
        const b = serviceTokenIssuerFromEnv(env, ISSUER, vi.fn());
        expect(a?.jwks()).toEqual(b?.jwks());
    });

    it('壊れた鍵は起動時に失敗させる（気づかないまま発行できない状態にしない）', () => {
        expect(() =>
            serviceTokenIssuerFromEnv(
                { SERVICE_TOKEN_SIGNING_KEY: 'not-a-key', BETTER_AUTH_SECRET: 'x' },
                ISSUER,
                vi.fn(),
            ),
        ).toThrow();
    });

    it('BETTER_AUTH_SECRET が無ければ仮名を作れないので失敗させる', () => {
        expect(() => serviceTokenIssuerFromEnv({ NODE_ENV: 'development' }, ISSUER, vi.fn())).toThrow(
            'BETTER_AUTH_SECRET',
        );
    });
});
