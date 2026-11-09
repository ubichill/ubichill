/**
 * Mastodon・Misskey など、ほかの ActivityPub の実装と話すための HTTP の署名（draft-cavage-http-signatures-12、rsa-sha256）。
 * ubichill 同士は httpSignature.ts（RFC 9421・Ed25519）を使い、こちらは inbox への配送と文書の取得だけに使う（RPC は受けない）。
 *
 * - 送る: POST は (request-target) host date digest content-type、GET は (request-target) host date accept に署名する
 * - 受ける: (request-target)・host・date は必須、POST は digest も。date は受け手の時刻の 1 時間前〜5 分後まで
 *   （相手は送り直しの列から出すときに署名し直すが、時計のずれと列の遅れを見込む。2 度目は activity の id で弾く）
 * - host と (request-target) は受け手が自分の正規のドメインと受けたパスから組み立てる（Host を信じない）ので、署名は宛先に縛られる
 *
 * 暗号（SHA-256・RSA）は呼び手が渡す（shared は Web Crypto を使わない）。
 */
import { base64ToBytes, bytesToBase64 } from './structuredFields';

export const CAVAGE_ALGORITHM = 'rsa-sha256';

/** 送るときに署名する項目。 */
export const CAVAGE_SIGNED_HEADERS = {
    post: ['(request-target)', 'host', 'date', 'digest', 'content-type'],
    get: ['(request-target)', 'host', 'date', 'accept'],
} as const;

/** 受けるときに署名されていなければならない項目。 */
export const CAVAGE_REQUIRED_HEADERS = {
    post: ['(request-target)', 'host', 'date', 'digest'],
    get: ['(request-target)', 'host', 'date'],
} as const;

export const CAVAGE_TIMING = {
    /** date がこれより古ければ断る（秒） */
    MAX_AGE_SEC: 60 * 60,
    /** date がこれより先なら断る（秒） */
    MAX_FUTURE_SEC: 5 * 60,
} as const;

/** 署名する・確かめる HTTP のメッセージ。header は小文字の名前で引く。 */
export interface CavageMessage {
    method: string;
    /** パスとクエリ（受け手は受けたもの、送り手は送る URL のもの） */
    path: string;
    /** 宛先のホスト（受け手は自分の正規のドメイン） */
    host: string;
    header(name: string): string | undefined;
}

/** 署名する文字列。項目が欠けている・知らない疑似項目なら null。 */
export function cavageSigningString(headers: readonly string[], message: CavageMessage): string | null {
    const lines = headers.map((name): string | null => {
        if (name === '(request-target)') return `(request-target): ${message.method.toLowerCase()} ${message.path}`;
        if (name.startsWith('(')) return null;
        const value = name === 'host' ? message.host : message.header(name)?.trim();
        return value === undefined || /[\r\n]/.test(value) ? null : `${name}: ${value}`;
    });
    return lines.every((l): l is string => l !== null) ? lines.join('\n') : null;
}

// shared は環境の型を持たないので、実行環境の TextEncoder（Node・ブラウザとも持つ）を最小の形で取り出す
const utf8 = (text: string): Uint8Array =>
    new (
        globalThis as unknown as { TextEncoder: new () => { encode(input: string): Uint8Array } }
    ).TextEncoder().encode(text);

/** 送り手: Signature ヘッダーの値を作る。sign は RSA-SHA256（PKCS#1 v1.5）の署名（呼び手が鍵を持つ）。 */
export async function signCavage(
    message: CavageMessage,
    headers: readonly string[],
    keyId: string,
    sign: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<string> {
    const text = cavageSigningString(headers, message);
    if (text === null) throw new Error('署名の対象が欠けています');
    const signature = await sign(utf8(text));
    return `keyId="${keyId}",algorithm="${CAVAGE_ALGORITHM}",headers="${headers.join(' ')}",signature="${bytesToBase64(signature)}"`;
}

interface ParsedCavage {
    keyId: string;
    algorithm: string | null;
    headers: string[];
    signature: Uint8Array;
}

/** Signature ヘッダーを読む（`name="value"` をカンマでつないだもの）。崩れていれば null。 */
export function parseCavageSignature(header: string): ParsedCavage | null {
    const pairs = [...header.matchAll(/\s*([A-Za-z]+)="([^"]*)"\s*(?:,|$)/g)];
    if (pairs.map((m) => m[0]).join('') !== header) return null;
    const fields = new Map(pairs.map((m) => [m[1] ?? '', m[2] ?? '']));
    const keyId = fields.get('keyId');
    const signature = base64ToBytes(fields.get('signature') ?? '');
    if (!keyId || !signature || signature.length === 0) return null;
    // headers が無ければ date だけ（draft の既定）。必須の項目が足りないので、確かめる段で断られる
    const headers = (fields.get('headers') ?? 'date').toLowerCase().split(/\s+/).filter(Boolean);
    return { keyId, algorithm: fields.get('algorithm')?.toLowerCase() ?? null, headers, signature };
}

export type CavageRejection =
    /** Signature が無い */
    | 'missing'
    /** 形が崩れている・date が読めない */
    | 'malformed'
    /** 必要な項目が署名されていない・メッセージに無い */
    | 'components'
    /** rsa-sha256（hs2019）でない */
    | 'algorithm'
    /** date が古すぎる */
    | 'expired'
    /** date が先すぎる */
    | 'future';

export interface ReadCavageSignature {
    keyId: string;
    /** 署名する文字列（受け手が組み立て直したもの） */
    signingString: string;
    signature: Uint8Array;
}

/**
 * 受け手: 署名の形・項目・時刻を確かめ、確かめるべき文字列と署名を取り出す（暗号の検証は呼び手が鍵で行う）。now は UNIX 秒。
 */
export function readCavageSignature(
    message: CavageMessage,
    options: { now: number },
): { ok: true; value: ReadCavageSignature } | { ok: false; reason: CavageRejection } {
    const header = message.header('signature');
    if (!header) return { ok: false, reason: 'missing' };
    const parsed = parseCavageSignature(header);
    if (!parsed) return { ok: false, reason: 'malformed' };
    // hs2019 は鍵の種類で決まる（ここで受ける鍵は RSA だけ）
    if (parsed.algorithm !== null && parsed.algorithm !== CAVAGE_ALGORITHM && parsed.algorithm !== 'hs2019') {
        return { ok: false, reason: 'algorithm' };
    }
    const required =
        message.method.toUpperCase() === 'POST' ? CAVAGE_REQUIRED_HEADERS.post : CAVAGE_REQUIRED_HEADERS.get;
    if (!required.every((name) => parsed.headers.includes(name))) return { ok: false, reason: 'components' };

    const date = Date.parse(message.header('date') ?? '');
    if (Number.isNaN(date)) return { ok: false, reason: 'malformed' };
    const at = Math.floor(date / 1000);
    if (at < options.now - CAVAGE_TIMING.MAX_AGE_SEC) return { ok: false, reason: 'expired' };
    if (at > options.now + CAVAGE_TIMING.MAX_FUTURE_SEC) return { ok: false, reason: 'future' };

    const signingString = cavageSigningString(parsed.headers, message);
    if (signingString === null) return { ok: false, reason: 'components' };
    return { ok: true, value: { keyId: parsed.keyId, signingString, signature: parsed.signature } };
}

/** RSA の照合（呼び手が渡す）。鍵は SPKI の PEM。不正な鍵・署名は throw せず false を返すこと。 */
export interface RsaVerifier {
    verifyRsaSha256(publicKeyPem: string, data: string, signature: Uint8Array): Promise<boolean>;
}

/** 読んだ署名を、actor の文書にある鍵（keyId が同じもの）で確かめる。 */
export async function verifyCavageSignature(
    read: Pick<ReadCavageSignature, 'keyId' | 'signingString' | 'signature'>,
    keys: ReadonlyArray<{ id: string; publicKeyPem: string }>,
    crypto: RsaVerifier,
): Promise<boolean> {
    const entry = keys.find((k) => k.id === read.keyId);
    if (!entry) return false;
    return crypto.verifyRsaSha256(entry.publicKeyPem, read.signingString, read.signature).catch(() => false);
}

/** Digest ヘッダーの値（`SHA-256=…`）。 */
export function digestHeader(sha256: Uint8Array): string {
    return `SHA-256=${bytesToBase64(sha256)}`;
}

/** Digest ヘッダーから SHA-256 を取り出す（ほかのアルゴリズムと並んでいてもよい。無ければ null）。 */
export function readDigestHeader(header: string | undefined): Uint8Array | null {
    if (!header) return null;
    const entry = header
        .split(',')
        .map((part) => part.trim())
        .find((part) => part.toLowerCase().startsWith('sha-256='));
    return entry ? base64ToBytes(entry.slice('sha-256='.length)) : null;
}
