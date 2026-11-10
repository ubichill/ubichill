/**
 * actor ごとの RSA の鍵（Mastodon・Misskey など、ほかの実装への draft-cavage の署名）。Ed25519（keys.ts）と違って種から
 * 導けないので、初めて要るときに作って DB に置く。秘密鍵は種から HKDF で導いた鍵で AES-256-GCM に包む（actor の id を AAD に
 * 入れ、ほかの actor の行へ写しても使えない）。
 *
 * 種を差し替えたら: 前の種（previousSeed）で開けた鍵は、いまの種で包み直す。どちらでも開けなければ作り直す
 * （相手は署名が通らなければ actor の文書を取り直すので、鍵が変わっても続く）。
 */
import {
    createCipheriv,
    createDecipheriv,
    createPrivateKey,
    createPublicKey,
    generateKeyPair,
    hkdfSync,
    type KeyObject,
    randomBytes,
    sign,
    verify,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { ActorKeyRecord, NewActorKey } from '@ubichill/db';
import { rsaKeyIdOf } from '@ubichill/shared';
import { setBounded } from '../../../utils/boundedMap';

const WRAP_SALT = 'ubichill federation rsa key wrap';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface RsaSigner {
    keyId: string;
    publicKeyPem: string;
    sign(data: Uint8Array): Uint8Array;
}

export interface RsaKeyring {
    /** その actor の鍵（無ければ作る）。userId はユーザーの鍵のとき（Application actor は null） */
    signerFor(actorId: string, userId: string | null): Promise<RsaSigner>;
}

export interface RsaKeyringDeps {
    seed: Uint8Array;
    previousSeed?: Uint8Array | null;
    repo: {
        get(actorId: string): Promise<ActorKeyRecord | undefined>;
        insertIfAbsent(key: NewActorKey, now: Date): Promise<ActorKeyRecord>;
        rewrap(actorId: string, privateKeyEncrypted: string): Promise<void>;
        replace(key: NewActorKey, unreadable: string, now: Date): Promise<ActorKeyRecord>;
    };
    /** 鍵を作る（テストでは小さい鍵や決まった鍵に差し替える） */
    generate?: () => Promise<{ publicKeyPem: string; privateKeyDer: Buffer }>;
    now(): number;
    max?: number;
}

const generateRsa = async (): Promise<{ publicKeyPem: string; privateKeyDer: Buffer }> => {
    const { publicKey, privateKey } = await promisify(generateKeyPair)('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    return { publicKeyPem: publicKey, privateKeyDer: privateKey };
};

/** RSA-SHA256（PKCS#1 v1.5）の照合。RSA でない鍵・崩れた鍵は false（shared の verifyCavageSignature に渡す）。 */
export async function verifyRsaSha256(publicKeyPem: string, data: string, signature: Uint8Array): Promise<boolean> {
    try {
        const key = createPublicKey(publicKeyPem);
        if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return false;
        return verify('sha256', Buffer.from(data, 'utf8'), key, signature);
    } catch {
        return false;
    }
}

const wrapKeyOf = (seed: Uint8Array): Buffer => Buffer.from(hkdfSync('sha256', seed, WRAP_SALT, 'v1', 32));

export function wrapPrivateKey(der: Buffer, seed: Uint8Array, actorId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', wrapKeyOf(seed), iv);
    cipher.setAAD(Buffer.from(actorId, 'utf8'));
    const body = Buffer.concat([cipher.update(der), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** 開けなければ null（種が違う・行が書き換えられた・別の actor の行）。 */
export function unwrapPrivateKey(wrapped: string, seed: Uint8Array, actorId: string): KeyObject | null {
    try {
        const bytes = Buffer.from(wrapped, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', wrapKeyOf(seed), bytes.subarray(0, IV_BYTES));
        decipher.setAAD(Buffer.from(actorId, 'utf8'));
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const der = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    } catch {
        return null;
    }
}

export function createRsaKeyring(deps: RsaKeyringDeps): RsaKeyring {
    const generate = deps.generate ?? generateRsa;
    const cache = new Map<string, RsaSigner>();
    const inflight = new Map<string, Promise<RsaSigner>>();

    const signerOf = (actorId: string, publicKeyPem: string, privateKey: KeyObject): RsaSigner => ({
        keyId: rsaKeyIdOf(actorId),
        publicKeyPem,
        sign: (data) => Uint8Array.from(sign('sha256', data, privateKey)),
    });

    const fresh = async (actorId: string, userId: string | null): Promise<NewActorKey> => {
        const { publicKeyPem, privateKeyDer } = await generate();
        return {
            actorId,
            userId,
            publicKeyPem,
            privateKeyEncrypted: wrapPrivateKey(privateKeyDer, deps.seed, actorId),
        };
    };

    /** 保存してある鍵を開く（前の種で開けたら包み直す。開けなければ作り直す）。 */
    const open = async (row: ActorKeyRecord, userId: string | null): Promise<RsaSigner> => {
        const current = unwrapPrivateKey(row.privateKeyEncrypted, deps.seed, row.actorId);
        if (current) return signerOf(row.actorId, row.publicKeyPem, current);
        const previous = deps.previousSeed
            ? unwrapPrivateKey(row.privateKeyEncrypted, deps.previousSeed, row.actorId)
            : null;
        if (previous) {
            const der = previous.export({ format: 'der', type: 'pkcs8' });
            await deps.repo.rewrap(row.actorId, wrapPrivateKey(der, deps.seed, row.actorId));
            return signerOf(row.actorId, row.publicKeyPem, previous);
        }
        const stored = await deps.repo.replace(
            await fresh(row.actorId, userId),
            row.privateKeyEncrypted,
            new Date(deps.now()),
        );
        const opened = unwrapPrivateKey(stored.privateKeyEncrypted, deps.seed, stored.actorId);
        if (!opened) throw new Error('RSA の鍵を開けません');
        return signerOf(stored.actorId, stored.publicKeyPem, opened);
    };

    const load = async (actorId: string, userId: string | null): Promise<RsaSigner> => {
        const row = await deps.repo.get(actorId);
        if (row) return open(row, userId);
        // 同時にほかの backend が作っていたら、そちらを使う
        return open(await deps.repo.insertIfAbsent(await fresh(actorId, userId), new Date(deps.now())), userId);
    };

    return {
        async signerFor(actorId, userId) {
            const hit = cache.get(actorId);
            if (hit) return hit;
            const running = inflight.get(actorId);
            if (running) return running;
            const promise = load(actorId, userId)
                .then((signer) => {
                    setBounded(cache, actorId, signer, deps.max ?? 1000);
                    return signer;
                })
                .finally(() => inflight.delete(actorId));
            inflight.set(actorId, promise);
            return promise;
        },
    };
}
