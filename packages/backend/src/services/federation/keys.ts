/**
 * actor ごとの Ed25519 の鍵。秘密鍵は保存せず、FEDERATION_KEY_SEED から HKDF で導く（docs/design/federation.md）。
 * seed = HKDF-SHA256(IKM=種, salt="ubichill federation actor key", info=actorId || 0x00 || uint32be(世代))
 * 種を差し替えると全員の鍵が差し替わるだけ（ほかのサーバーは鍵を固定せず、オリジンから取り直す）。
 */
import { createPrivateKey, createPublicKey, hkdfSync, type KeyObject, sign } from 'node:crypto';
import { ed25519Multikey, keyIdOf } from '@ubichill/shared';
import { setBounded } from '../../utils/boundedMap';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SALT = 'ubichill federation actor key';

export function deriveActorPrivateKey(seed: Uint8Array, actorId: string, generation = 1): KeyObject {
    const gen = Buffer.alloc(4);
    gen.writeUInt32BE(generation);
    const info = Buffer.concat([Buffer.from(actorId, 'utf8'), Buffer.from([0]), gen]);
    const raw = Buffer.from(hkdfSync('sha256', seed, SALT, info, 32));
    return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, raw]), format: 'der', type: 'pkcs8' });
}

/** Ed25519 の公開鍵の 32 バイト。 */
export function publicKeyBytes(key: KeyObject): Uint8Array {
    const { x } = createPublicKey(key).export({ format: 'jwk' });
    if (typeof x !== 'string') throw new Error('Ed25519 の鍵ではありません');
    return Uint8Array.from(Buffer.from(x, 'base64url'));
}

export interface ActorSigner {
    keyId: string;
    publicKeyMultibase: string;
    sign(data: Uint8Array): Uint8Array;
}

export interface Keyring {
    signerFor(actorId: string): ActorSigner;
}

/** actor ごとの署名器（導くのは重くないが、よく使う actor は覚えておく）。 */
export function createKeyring(seed: Uint8Array, max = 1000): Keyring {
    const cache = new Map<string, ActorSigner>();
    return {
        signerFor(actorId) {
            const hit = cache.get(actorId);
            if (hit) return hit;
            const privateKey = deriveActorPrivateKey(seed, actorId);
            const signer: ActorSigner = {
                keyId: keyIdOf(actorId),
                publicKeyMultibase: ed25519Multikey(publicKeyBytes(privateKey)),
                sign: (data) => Uint8Array.from(sign(null, data, privateKey)),
            };
            setBounded(cache, actorId, signer, max);
            return signer;
        },
    };
}
