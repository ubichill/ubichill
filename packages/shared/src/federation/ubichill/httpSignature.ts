/**
 * サーバー間の HTTP の署名（RFC 9421 HTTP Message Signatures）の ubichill プロファイル v1 と、本文の要約（RFC 9530 Content-Digest）。
 *
 * - 署名は Ed25519 だけ（alg="ed25519"）。ラベルは sig1。受け手は最初のラベル 1 つだけを確かめる
 * - POST は ("@method" "@target-uri" "content-type" "content-digest")、GET は ("@method" "@target-uri") を必ず含める
 * - created は必須（受け手の時刻の -300 秒〜+60 秒）。expires があれば、その 30 秒後まで・created から 300 秒まで
 * - 入室など権利を返す RPC は nonce 必須（受け手が覚えて 2 度目を断る）
 * - `@target-uri` は受け手が自分の正規のオリジンから組み立てる（Host を信じない）ので、署名は宛先に縛られる
 *
 * 暗号（SHA-256・Ed25519）は呼び手が渡す（shared は Web Crypto・URL を使わない）。
 */
import type { WorldCrypto } from '../../signature/primitives';
import {
    bytesToBase64,
    type InnerList,
    type Parameters,
    parseDictionary,
    serializeInnerList,
} from '../structuredFields';
import { parseEd25519Multikey } from './multikey';

export const SIGNATURE_LABEL = 'sig1';
export const SIGNATURE_ALGORITHM = 'ed25519';

/** 署名に必ず含める項目。 */
export const REQUIRED_COMPONENTS = {
    post: ['@method', '@target-uri', 'content-type', 'content-digest'],
    get: ['@method', '@target-uri'],
} as const;

export const SIGNATURE_TIMING = {
    /** created がこれより古ければ断る（秒） */
    MAX_AGE_SEC: 300,
    /** created がこれより先なら断る（時計のずれ、秒） */
    MAX_FUTURE_SEC: 60,
    /** expires を過ぎてもこれだけは受ける（秒） */
    EXPIRES_GRACE_SEC: 30,
    /** expires - created の上限（秒） */
    MAX_LIFETIME_SEC: 300,
    /** inbox への配送の有効期間（秒） */
    INBOX_TTL_SEC: 300,
    /** RPC の有効期間（秒） */
    RPC_TTL_SEC: 60,
} as const;

/** 署名する・確かめる HTTP のメッセージ。header は小文字の名前で引く。 */
export interface SignableMessage {
    method: string;
    /** 宛先の正規の URL（送り手は送る URL、受け手は自分のオリジンと受けたパス・クエリから組み立てる） */
    targetUri: string;
    /** `@authority`（小文字の host[:port]、既定のポートは付けない）。使うときだけ */
    authority?: string;
    /** `@path`。使うときだけ */
    path?: string;
    /** `@query`（`?` から。無ければ `?`）。使うときだけ */
    query?: string;
    header(name: string): string | undefined;
}

export interface SignatureParamsInput {
    /** UNIX 秒 */
    created: number;
    expires?: number;
    nonce?: string;
    keyid: string;
    alg?: string;
}

/** 署名の対象と params を、Signature-Input の値（Inner List）にする。params の順は created・expires・nonce・keyid・alg。 */
export function signatureParamsList(components: readonly string[], params: SignatureParamsInput): InnerList {
    const list: Parameters = [['created', { type: 'integer', value: params.created }]];
    if (params.expires !== undefined) list.push(['expires', { type: 'integer', value: params.expires }]);
    if (params.nonce !== undefined) list.push(['nonce', { type: 'string', value: params.nonce }]);
    list.push(['keyid', { type: 'string', value: params.keyid }]);
    if (params.alg !== undefined) list.push(['alg', { type: 'string', value: params.alg }]);
    return {
        kind: 'inner-list',
        items: components.map((name) => ({ kind: 'item', value: { type: 'string', value: name }, params: [] })),
        params: list,
    };
}

/** 署名の対象 1 つの値（RFC 9421 §2.1・§2.2）。無ければ undefined。 */
export function componentValue(name: string, message: SignableMessage): string | undefined {
    switch (name) {
        case '@method':
            return message.method.toUpperCase();
        case '@target-uri':
            return message.targetUri;
        case '@authority':
            return message.authority;
        case '@path':
            return message.path;
        case '@query':
            return message.query;
        default: {
            if (name.startsWith('@')) return undefined;
            const value = message.header(name);
            return value === undefined ? undefined : value.trim();
        }
    }
}

/** 署名する文字列（signature base）。対象が欠けていれば null。項目に params の付いたもの（;sf など）は扱わない。 */
export function signatureBase(list: InnerList, message: SignableMessage): string | null {
    const lines: string[] = [];
    for (const item of list.items) {
        if (item.value.type !== 'string' || item.params.length > 0) return null;
        const name = item.value.value;
        if (name !== name.toLowerCase()) return null;
        const value = componentValue(name, message);
        if (value === undefined || /[\r\n]/.test(value)) return null;
        lines.push(`"${name}": ${value}`);
    }
    lines.push(`"@signature-params": ${serializeInnerList(list)}`);
    return lines.join('\n');
}

// shared は環境の型を持たないので、実行環境の TextEncoder（Node・ブラウザとも持つ）を最小の形で取り出す
const utf8 = (text: string): Uint8Array =>
    new (
        globalThis as unknown as { TextEncoder: new () => { encode(input: string): Uint8Array } }
    ).TextEncoder().encode(text);

/** 送り手: Signature-Input と Signature のヘッダーを作る。sign は Ed25519 の署名（呼び手が鍵を持つ）。 */
export async function signMessage(
    message: SignableMessage,
    components: readonly string[],
    params: SignatureParamsInput,
    sign: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<{ 'signature-input': string; signature: string }> {
    const list = signatureParamsList(components, params);
    const base = signatureBase(list, message);
    if (base === null) throw new Error('署名の対象が欠けています');
    const signature = await sign(utf8(base));
    return {
        'signature-input': `${SIGNATURE_LABEL}=${serializeInnerList(list)}`,
        signature: `${SIGNATURE_LABEL}=:${bytesToBase64(signature)}:`,
    };
}

export type SignatureRejection =
    /** Signature-Input・Signature が無い */
    | 'missing'
    /** 形が崩れている・ラベルが揃わない */
    | 'malformed'
    /** 必要な対象が署名されていない・メッセージに無い */
    | 'components'
    /** Ed25519 でない */
    | 'algorithm'
    /** created が古すぎる・expires が過ぎた・有効期間が長すぎる */
    | 'expired'
    /** created が先すぎる */
    | 'future'
    /** nonce が要るのに無い・形が悪い */
    | 'nonce';

export interface ReadSignature {
    keyid: string;
    created: number;
    expires?: number;
    nonce?: string;
    /** 署名する文字列（受け手が組み立て直したもの） */
    base: string;
    signature: Uint8Array;
}

const NONCE_PATTERN = /^[A-Za-z0-9_\-+/=.]{8,128}$/;

/**
 * 受け手: 署名の形・対象・時刻を確かめ、確かめるべき文字列と署名を取り出す（暗号の検証は呼び手が鍵で行う）。
 * now は UNIX 秒。
 */
export function readSignature(
    message: SignableMessage,
    options: { required: readonly string[]; now: number; requireNonce?: boolean },
): { ok: true; value: ReadSignature } | { ok: false; reason: SignatureRejection } {
    const inputHeader = message.header('signature-input');
    const signatureHeader = message.header('signature');
    if (!inputHeader || !signatureHeader) return { ok: false, reason: 'missing' };
    const inputs = parseDictionary(inputHeader);
    const signatures = parseDictionary(signatureHeader);
    const first = inputs ? [...inputs][0] : undefined;
    if (!inputs || !signatures || !first) return { ok: false, reason: 'malformed' };
    const [label, list] = first;
    const sig = signatures.get(label);
    if (list.kind !== 'inner-list' || !sig || sig.kind !== 'item' || sig.value.type !== 'bytes') {
        return { ok: false, reason: 'malformed' };
    }

    const covered = new Set(list.items.flatMap((i) => (i.value.type === 'string' ? [i.value.value] : [])));
    if (!options.required.every((name) => covered.has(name))) return { ok: false, reason: 'components' };

    const param = (key: string) => list.params.find(([k]) => k === key)?.[1];
    const keyid = param('keyid');
    const created = param('created');
    const expires = param('expires');
    const nonce = param('nonce');
    const alg = param('alg');
    if (keyid?.type !== 'string' || keyid.value === '' || created?.type !== 'integer') {
        return { ok: false, reason: 'malformed' };
    }
    if (expires !== undefined && expires.type !== 'integer') return { ok: false, reason: 'malformed' };
    if (alg !== undefined && (alg.type !== 'string' || alg.value !== SIGNATURE_ALGORITHM)) {
        return { ok: false, reason: 'algorithm' };
    }
    if (nonce !== undefined && (nonce.type !== 'string' || !NONCE_PATTERN.test(nonce.value))) {
        return { ok: false, reason: 'nonce' };
    }
    if (options.requireNonce && nonce === undefined) return { ok: false, reason: 'nonce' };

    const now = options.now;
    if (created.value < now - SIGNATURE_TIMING.MAX_AGE_SEC) return { ok: false, reason: 'expired' };
    if (created.value > now + SIGNATURE_TIMING.MAX_FUTURE_SEC) return { ok: false, reason: 'future' };
    if (expires?.type === 'integer') {
        if (now > expires.value + SIGNATURE_TIMING.EXPIRES_GRACE_SEC) return { ok: false, reason: 'expired' };
        if (expires.value - created.value > SIGNATURE_TIMING.MAX_LIFETIME_SEC || expires.value < created.value) {
            return { ok: false, reason: 'expired' };
        }
    }

    const base = signatureBase(list, message);
    if (base === null) return { ok: false, reason: 'components' };
    return {
        ok: true,
        value: {
            keyid: keyid.value,
            created: created.value,
            ...(expires?.type === 'integer' ? { expires: expires.value } : {}),
            ...(nonce?.type === 'string' ? { nonce: nonce.value } : {}),
            base,
            signature: sig.value.value,
        },
    };
}

const base64url = (bytes: Uint8Array): string =>
    bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * 読んだ署名を、actor の文書にある鍵（keyid が同じもの）で確かめる。HTTP の署名の照合はこの 1 か所で行う
 * （docs/PROTOCOLS.md の「署名の照合は shared の 1 か所」）。暗号は呼び手が渡す。
 */
export async function verifySignature(
    read: Pick<ReadSignature, 'keyid' | 'base' | 'signature'>,
    keys: ReadonlyArray<{ id: string; publicKeyMultibase: string }>,
    crypto: Pick<WorldCrypto, 'verifyEd25519'>,
): Promise<boolean> {
    const entry = keys.find((k) => k.id === read.keyid);
    const key = entry ? parseEd25519Multikey(entry.publicKeyMultibase) : null;
    if (!key) return false;
    return crypto.verifyEd25519(base64url(key), read.base, base64url(read.signature)).catch(() => false);
}

/** Content-Digest の値（`sha-256=:…:`）。 */
export function contentDigest(sha256: Uint8Array): string {
    return `sha-256=:${bytesToBase64(sha256)}:`;
}

/** Content-Digest から sha-256 を取り出す（無い・崩れていれば null）。 */
export function readContentDigest(header: string | undefined): Uint8Array | null {
    if (!header) return null;
    const dict = parseDictionary(header);
    const member = dict?.get('sha-256');
    return member?.kind === 'item' && member.value.type === 'bytes' ? member.value.value : null;
}

/** バイト列が同じか（長さが同じなら最後まで比べる）。 */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return a.reduce((diff, byte, i) => diff | (byte ^ (b[i] ?? 0)), 0) === 0;
}
