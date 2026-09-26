/**
 * ワールドの contentHash 算出と作者署名の生成・検証（純粋ロジック）。
 *
 * 暗号プリミティブ（sha256 / ed25519）は {@link WorldCrypto} として呼び出し側が注入する
 * （backend は node:crypto、CLI/ブラウザは WebCrypto）。ここは正規化・照合順序・判定だけを持つ。
 *
 * ハッシュ対象は「配信された生の値」。YAML なら `yaml.parse` 直後（マイグレーション・スキーマ既定値
 * 適用前）、lock なら JSON の生値を渡すこと。スキーマ適用後の値を渡すと配信元と一致しない。
 */
import { formatIntegrity, integrityEquals } from '../mod/modLock';
import {
    Ed25519PublicKeySchema,
    type WorldIdentity,
    type WorldSignature,
    WorldSignatureSchema,
} from '../schemas/worldIdentity.schema';

export interface WorldCrypto {
    /** UTF-8 文字列の sha256 を標準 base64 で返す。 */
    sha256Base64(text: string): Promise<string>;
    /** ed25519 検証。鍵・署名は base64url。不正な鍵・署名は throw せず false を返すこと。 */
    verifyEd25519(publicKey: string, message: string, signature: string): Promise<boolean>;
}

export interface WorldSigningKey {
    /** base64url の ed25519 公開鍵。 */
    readonly publicKey: string;
    /** UTF-8 文字列に署名し base64url を返す。 */
    sign(message: string): Promise<string>;
}

/** ハッシュ対象。lock は兄弟配信の生 JSON（無ければ null）。埋め込み `spec.lock` は definition 側に含まれる。 */
export interface WorldDocument {
    definition: unknown;
    lock?: unknown;
}

export type WorldSignatureInvalidReason = 'malformed' | 'name-mismatch' | 'content-mismatch' | 'bad-signature';

export type WorldIdentityVerdict = WorldIdentity | { status: 'invalid'; reason: WorldSignatureInvalidReason };

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * RFC 8785 (JCS) 相当の正規化 JSON。キーは UTF-16 コード単位順、空白無し。
 * `JSON.stringify` と同じく object の undefined 値は落とし、配列内の undefined は null にする。
 * 非有限数・Date/Map 等の非プレーン object・bigint 等は署名対象として曖昧なので throw する。
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) throw new TypeError(`正規化できない数値: ${value}`);
            return JSON.stringify(value);
        case 'string':
            return JSON.stringify(value);
        case 'object': {
            if (Array.isArray(value)) {
                return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
            }
            if (!isPlainObject(value)) throw new TypeError('正規化できない object（プレーン object のみ可）');
            const entries = Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
        }
        default:
            throw new TypeError(`正規化できない値の型: ${typeof value}`);
    }
}

export async function worldContentHash(doc: WorldDocument, crypto: WorldCrypto): Promise<string> {
    const text = canonicalJson({ definition: doc.definition, lock: doc.lock ?? null });
    return formatIntegrity(await crypto.sha256Base64(text));
}

/** 生の definition から `metadata.name` を安全に取り出す（スキーマ検証前でも使える）。 */
export function worldNameOf(definition: unknown): string | undefined {
    if (typeof definition !== 'object' || definition === null) return undefined;
    const metadata = (definition as { metadata?: unknown }).metadata;
    if (typeof metadata !== 'object' || metadata === null) return undefined;
    const name = (metadata as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/**
 * 一覧・検索に公開してよいか。作者署名を検証できたワールドだけを公開する。
 * 未署名・識別不明（検証していない自己申告）は URL を直接知っている人だけが確認付きで入れる。
 */
export function isPublishable(identity: WorldIdentity | undefined): boolean {
    return identity?.status === 'verified';
}

/** 版をまたいで不変なワールド識別子（作者アカウント未確認時は鍵で識別する）。 */
export function worldIdOf(publicKey: string, name: string): string {
    return `ed25519:${publicKey}/${name}`;
}

/** 作者アカウントを確認できたワールドの識別子。鍵を入れ替えても変わらない。 */
export function authorWorldIdOf(author: string, name: string): string {
    return `acct:${author}/${name}`;
}

/**
 * 作者アカウント（`handle@domain`）の現在の署名公開鍵を返す。見つからなければ undefined。
 * 実装は呼び出し側（自サーバーの DB / 他ドメインの WebFinger）。
 */
export type AuthorKeyResolver = (author: string) => Promise<string | undefined>;

/** 署名対象のバイト列（UTF-8 化は crypto 側）。signature 以外の全フィールドを正規化する。 */
export function worldSignaturePayload(fields: Omit<WorldSignature, 'signature'>): string {
    // author が無い署名は従来と同じバイト列になる（canonicalJson は undefined を落とす）。
    return canonicalJson({
        version: fields.version,
        alg: fields.alg,
        publicKey: fields.publicKey,
        name: fields.name,
        contentHash: fields.contentHash,
        author: fields.author,
    });
}

export async function signWorld(
    doc: WorldDocument,
    key: WorldSigningKey,
    crypto: WorldCrypto,
    options: { author?: string } = {},
): Promise<WorldSignature> {
    const name = worldNameOf(doc.definition);
    if (!name) throw new Error('metadata.name が無いワールドには署名できません');
    const fields = {
        version: 1 as const,
        alg: 'ed25519' as const,
        publicKey: key.publicKey,
        name,
        contentHash: await worldContentHash(doc, crypto),
        ...(options.author ? { author: options.author } : {}),
    };
    return { ...fields, signature: await key.sign(worldSignaturePayload(fields)) };
}

/**
 * 署名を検証して識別結果を返す。`rawSignature` が null/undefined なら unsigned。
 * 照合順: 形式 → name → contentHash → 署名。安価な判定を先に行い、署名検証は最後。
 *
 * 署名が主張する作者アカウントは `resolveAuthorKey` で引いた公開鍵が署名鍵と一致したときだけ採用する。
 * 一致しない・引けない・resolver が無い場合は作者を付けず鍵で識別する（なりすましを表示しない）。
 * 署名自体は正しいので invalid にはしない（鍵の入れ替え後の古い署名もここに来る）。
 */
export async function verifyWorldSignature(
    doc: WorldDocument,
    rawSignature: unknown,
    crypto: WorldCrypto,
    resolveAuthorKey?: AuthorKeyResolver,
): Promise<WorldIdentityVerdict> {
    const contentHash = await worldContentHash(doc, crypto);
    if (rawSignature === null || rawSignature === undefined) return { status: 'unsigned', contentHash };

    const parsed = WorldSignatureSchema.safeParse(rawSignature);
    if (!parsed.success) return { status: 'invalid', reason: 'malformed' };
    const sig = parsed.data;

    if (sig.name !== worldNameOf(doc.definition)) return { status: 'invalid', reason: 'name-mismatch' };
    if (!integrityEquals(sig.contentHash, contentHash)) return { status: 'invalid', reason: 'content-mismatch' };

    const ok = await crypto.verifyEd25519(sig.publicKey, worldSignaturePayload(sig), sig.signature).catch(() => false);
    if (!ok) return { status: 'invalid', reason: 'bad-signature' };

    const authorKey =
        sig.author && resolveAuthorKey ? await resolveAuthorKey(sig.author).catch(() => undefined) : undefined;
    if (sig.author && authorKey === sig.publicKey) {
        return {
            status: 'verified',
            worldId: authorWorldIdOf(sig.author, sig.name),
            publicKey: sig.publicKey,
            contentHash,
            author: sig.author,
        };
    }
    return { status: 'verified', worldId: worldIdOf(sig.publicKey, sig.name), publicKey: sig.publicKey, contentHash };
}

// ============================================
// 署名鍵のアカウント登録（所有の証明）
// ============================================

/** 登録リクエストの有効期間。これより古い・未来すぎる証明は拒否する（再利用・時計ずれ対策）。 */
export const KEY_REGISTRATION_MAX_SKEW_MS = 5 * 60 * 1000;

export interface KeyRegistrationClaim {
    userId: string;
    publicKey: string;
    /** ISO 8601。 */
    at: string;
}

/**
 * 公開鍵をアカウントに登録するとき、その鍵で署名させる文。
 * 公開鍵だけを受け付けると、他人の公開鍵を自分の handle に登録して他人のワールドを自分の作品に
 * 見せかけられるため、秘密鍵を持っていることを証明させる。userId を含めるので他アカウントに流用できない。
 */
export function keyRegistrationMessage(claim: KeyRegistrationClaim): string {
    return canonicalJson({
        purpose: 'ubichill-signing-key-registration',
        userId: claim.userId,
        publicKey: claim.publicKey,
        at: claim.at,
    });
}

export type KeyRegistrationVerdict = { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'bad-signature' };

export async function verifyKeyRegistration(
    claim: KeyRegistrationClaim,
    signature: string,
    now: number,
    crypto: WorldCrypto,
): Promise<KeyRegistrationVerdict> {
    const at = Date.parse(claim.at);
    if (!Ed25519PublicKeySchema.safeParse(claim.publicKey).success || Number.isNaN(at)) {
        return { ok: false, reason: 'malformed' };
    }
    if (Math.abs(now - at) > KEY_REGISTRATION_MAX_SKEW_MS) return { ok: false, reason: 'expired' };
    const ok = await crypto.verifyEd25519(claim.publicKey, keyRegistrationMessage(claim), signature).catch(() => false);
    return ok ? { ok: true } : { ok: false, reason: 'bad-signature' };
}
