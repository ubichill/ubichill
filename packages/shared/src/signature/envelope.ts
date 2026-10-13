/**
 * 作者署名の形式（封筒）。ワールド・mod など、作者が署名するものはすべてこの形式で署名する（docs/PROTOCOLS.md）。
 *
 * 違いは `kind` と、内容のハッシュ（`contentHash`）の求め方だけ。署名する値は `signature` 以外の全項目の正規化した JSON で、
 * `format` と `kind` が入るので、別の種類・別の用途の署名として使い回せない。作者は必須で、正規の表記だけを受け付ける。
 *
 * 検証の順番はどの種類も同じ: 形式を読む → 種類・対象・内容を照らす → 署名を照合する → 作者の鍵を確かめる。
 * 安価な判定を先に行い、作者の確認（他サーバーへの問い合わせ）は最後。
 * 暗号（sha256 / ed25519）は呼び出し側が注入する（{@link WorldCrypto}）。
 */
import { z } from 'zod';
import { IntegritySchema } from '../schemas/modLock.schema';
import { Ed25519PublicKeySchema, Ed25519SignatureSchema } from '../schemas/worldIdentity.schema';
import { isCanonicalAuthorAccount } from '../user/handle';
import {
    type AuthorKeyCheck,
    type AuthorKeyCheckResult,
    canonicalJson,
    type WorldCrypto,
    type WorldSigningKey,
} from './primitives';

export const SIGNATURE_FORMAT = 'ubichill-signature';
export const SIGNATURE_VERSION = 2;
export const SIGNATURE_KINDS = ['world', 'mod'] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

/** 署名に入れる作者アカウント。正規の表記（`handle@domain`、ドメインは小文字）だけ。 */
export const SignedAuthorSchema = z
    .string()
    .max(300)
    .refine(isCanonicalAuthorAccount, '作者アカウントは正規の表記（handle@domain、ドメインは小文字）にしてください');

export const SignatureEnvelopeSchema = z.object({
    format: z.literal(SIGNATURE_FORMAT),
    version: z.literal(SIGNATURE_VERSION),
    kind: z.enum(SIGNATURE_KINDS),
    alg: z.literal('ed25519'),
    publicKey: Ed25519PublicKeySchema,
    author: SignedAuthorSchema,
    /** 署名する対象の名前（ワールドは metadata.name、mod は mod の ID）。 */
    subject: z.string().min(1).max(200),
    /** 対象の版（mod の版）。版が内容のハッシュに入らない種類だけが使う。 */
    subjectVersion: z.string().min(1).max(100).optional(),
    contentHash: IntegritySchema,
    signature: Ed25519SignatureSchema,
});
export type SignatureEnvelope = z.infer<typeof SignatureEnvelopeSchema>;

export type SignatureFields = Omit<SignatureEnvelope, 'signature'>;

/** ワールドの署名（`<world>.sig.json`）。 */
export const WorldSignatureSchema = SignatureEnvelopeSchema.extend({ kind: z.literal('world') });
export type WorldSignature = z.infer<typeof WorldSignatureSchema>;

/** mod の署名（`v<版>/lock.sig.json`）。 */
export const ModSignatureSchema = SignatureEnvelopeSchema.extend({
    kind: z.literal('mod'),
    subjectVersion: z.string().min(1).max(100),
});
export type ModSignature = z.infer<typeof ModSignatureSchema>;

/** 配布物の中の mod の署名ファイル名（`<base>/<modId>/v<version>/lock.sig.json`）。 */
export const MOD_SIGNATURE_FILE = 'lock.sig.json';

/** 署名する値（UTF-8 化は crypto 側）。`signature` 以外の全項目を正規化する。 */
export function signaturePayload(fields: SignatureFields): string {
    return canonicalJson({
        format: fields.format,
        version: fields.version,
        kind: fields.kind,
        alg: fields.alg,
        publicKey: fields.publicKey,
        author: fields.author,
        subject: fields.subject,
        subjectVersion: fields.subjectVersion,
        contentHash: fields.contentHash,
    });
}

export interface SignatureTarget {
    kind: SignatureKind;
    subject: string;
    subjectVersion?: string;
    contentHash: string;
}

export async function signEnvelope(
    target: SignatureTarget,
    key: WorldSigningKey,
    author: string,
): Promise<SignatureEnvelope> {
    if (!isCanonicalAuthorAccount(author)) {
        throw new Error(`作者アカウントは正規の表記（handle@domain、ドメインは小文字）で署名してください: ${author}`);
    }
    const fields: SignatureFields = {
        format: SIGNATURE_FORMAT,
        version: SIGNATURE_VERSION,
        kind: target.kind,
        alg: 'ed25519',
        publicKey: key.publicKey,
        author,
        subject: target.subject,
        ...(target.subjectVersion !== undefined ? { subjectVersion: target.subjectVersion } : {}),
        contentHash: target.contentHash,
    };
    return { ...fields, signature: await key.sign(signaturePayload(fields)) };
}

/**
 * - malformed: 形式が違う（版 1 の署名・作者の無い署名・揺れた表記の作者を含む）
 * - kind-mismatch: 別の種類の署名
 * - subject-mismatch: 別の対象（名前・版）の署名
 * - content-mismatch: 署名された内容と違う
 * - bad-signature: 署名が鍵と合わない
 */
export type EnvelopeInvalidReason =
    | 'malformed'
    | 'kind-mismatch'
    | 'subject-mismatch'
    | 'content-mismatch'
    | 'bad-signature';

export type EnvelopeVerdict =
    | { status: 'missing' }
    | { status: 'invalid'; reason: EnvelopeInvalidReason }
    | { status: 'signed'; envelope: SignatureEnvelope };

/** 形式を読み、種類・対象・内容を照らし、署名を照合する（作者はまだ確かめない）。 */
export async function verifyEnvelope(
    raw: unknown,
    target: SignatureTarget,
    crypto: WorldCrypto,
): Promise<EnvelopeVerdict> {
    if (raw === null || raw === undefined) return { status: 'missing' };
    const parsed = SignatureEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return { status: 'invalid', reason: 'malformed' };
    const envelope = parsed.data;
    if (envelope.kind !== target.kind) return { status: 'invalid', reason: 'kind-mismatch' };
    if (envelope.subject !== target.subject || envelope.subjectVersion !== target.subjectVersion) {
        return { status: 'invalid', reason: 'subject-mismatch' };
    }
    if (envelope.contentHash.trim() !== target.contentHash.trim())
        return { status: 'invalid', reason: 'content-mismatch' };
    const ok = await crypto
        .verifyEd25519(envelope.publicKey, signaturePayload(envelope), envelope.signature)
        .catch(() => false);
    return ok ? { status: 'signed', envelope } : { status: 'invalid', reason: 'bad-signature' };
}

/**
 * 署名の作者を確かめる（署名鍵が作者の有効な公開環境の鍵か）。判定器が無ければ確かめられない。例外は「いまは確かめられない」。
 * 作者を確かめられなくても署名自体は正しいので、どう扱うか（ワールドは鍵で識別、mod は実行しない）は種類ごとに決める。
 */
export function confirmEnvelopeAuthor(
    envelope: SignatureEnvelope,
    isAuthorKey: AuthorKeyCheck | undefined,
): Promise<AuthorKeyCheckResult> {
    if (!isAuthorKey) return Promise.resolve({ status: 'unconfirmed' });
    return isAuthorKey(envelope.author, envelope.publicKey, envelope.contentHash).catch(
        () => ({ status: 'pending' }) as const,
    );
}
