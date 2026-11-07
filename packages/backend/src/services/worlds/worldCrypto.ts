import { createHash, createPublicKey, verify } from 'node:crypto';
import type { WorldCrypto } from '@ubichill/shared';

/**
 * node:crypto による {@link WorldCrypto} 実装（検証専用）。
 * サーバーは署名鍵を持たない。署名は作者が手元の鍵で行い、サーバーは検証・保存・配信だけする。
 */
export const nodeWorldCrypto: WorldCrypto = {
    sha256Base64: async (text) => createHash('sha256').update(text, 'utf8').digest('base64'),
    verifyEd25519: async (publicKey, message, signature) => {
        try {
            const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
            return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature, 'base64url'));
        } catch {
            return false;
        }
    },
};
