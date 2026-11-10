/**
 * actor ごとの Ed25519 の鍵。秘密鍵は保存せず、FEDERATION_KEY_SEED から HKDF で導く（docs/design/federation.md）。
 * seed = HKDF-SHA256(IKM=種, salt="ubichill federation actor key", info=actorId || 0x00 || uint32be(世代))
 * 種を差し替えると全員の鍵が差し替わるだけ（ほかのサーバーは鍵を固定せず、オリジンから取り直す）。
 *
 * 鍵の移行: 新しい種と一緒に世代を 1 上げ（keyid が `#ed25519-<世代>` に変わるので、相手はすぐ取り直す）、
 * 前の種を previousSeed に置く。移行の間は前の世代の鍵も actor の文書に載せる（前の鍵で署名して送った分も通る）。
 * 送り直し（48 時間）と相手のキャッシュ（24 時間）が過ぎたら previousSeed を外す。
 */
import { createPrivateKey, createPublicKey, hkdfSync, type KeyObject, sign } from 'node:crypto';
import { ed25519Multikey, keyIdOf } from '@ubichill/shared';
import { setBounded } from '../../../utils/boundedMap';

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
    /** いまの世代の鍵で署名する */
    signerFor(actorId: string): ActorSigner;
    /** 移行の間だけ文書に載せる前の世代の鍵（無ければ空） */
    previousKeysFor(actorId: string): Array<{ keyId: string; publicKeyMultibase: string }>;
}

export interface KeyringOptions {
    seed: Uint8Array;
    /** いまの鍵の世代（1 から） */
    generation?: number;
    /** 移行の間だけ: 前の世代（generation - 1）の種。無くて generation が 2 以上なら、同じ種の前の世代 */
    previousSeed?: Uint8Array | null;
    max?: number;
}

/** actor ごとの署名器（導くのは重くないが、よく使う actor は覚えておく）。 */
export function createKeyring({ seed, generation = 1, previousSeed = null, max = 1000 }: KeyringOptions): Keyring {
    if (!Number.isInteger(generation) || generation < 1) throw new Error('鍵の世代は 1 以上の整数です');
    if (previousSeed && generation < 2) throw new Error('前の種を置くときは、鍵の世代を 2 以上に上げてください');
    const cache = new Map<string, ActorSigner>();
    return {
        signerFor(actorId) {
            const hit = cache.get(actorId);
            if (hit) return hit;
            const privateKey = deriveActorPrivateKey(seed, actorId, generation);
            const signer: ActorSigner = {
                keyId: keyIdOf(actorId, generation),
                publicKeyMultibase: ed25519Multikey(publicKeyBytes(privateKey)),
                sign: (data) => Uint8Array.from(sign(null, data, privateKey)),
            };
            setBounded(cache, actorId, signer, max);
            return signer;
        },
        previousKeysFor(actorId) {
            if (generation < 2) return [];
            const previous = deriveActorPrivateKey(previousSeed ?? seed, actorId, generation - 1);
            return [
                {
                    keyId: keyIdOf(actorId, generation - 1),
                    publicKeyMultibase: ed25519Multikey(publicKeyBytes(previous)),
                },
            ];
        },
    };
}
