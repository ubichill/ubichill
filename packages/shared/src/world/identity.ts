/**
 * ワールドの contentHash 算出と作者署名の生成・検証（純粋ロジック）。
 *
 * 暗号プリミティブ（sha256 / ed25519）は {@link WorldCrypto} として呼び出し側が注入する
 * （backend は node:crypto、CLI/ブラウザは WebCrypto）。ここは正規化・照合順序・判定だけを持つ。
 *
 * ハッシュ対象は「配信された生の値」。YAML なら `yaml.parse` 直後（マイグレーション・スキーマ既定値
 * 適用前）、lock なら JSON の生値を渡すこと。スキーマ適用後の値を渡すと配信元と一致しない。
 */
import { formatIntegrity } from '../mod/modLock';
import { ModLockSchema } from '../schemas/modLock.schema';
import { unlockedModIds, WorldDefinitionSchema } from '../schemas/world.schema';
import { Ed25519PublicKeySchema, type WorldIdentity } from '../schemas/worldIdentity.schema';
import {
    confirmEnvelopeAuthor,
    type EnvelopeInvalidReason,
    type SignatureTarget,
    signEnvelope,
    verifyEnvelope,
    type WorldSignature,
} from '../signature/envelope';
import {
    type AuthorKeyCheck,
    type AuthorKeyCheckResult,
    canonicalJson,
    type WorldCrypto,
    type WorldSigningKey,
} from '../signature/primitives';

/** ハッシュ対象。lock は兄弟配信の生 JSON（無ければ null）。埋め込み `spec.lock` は definition 側に含まれる。 */
export interface WorldDocument {
    definition: unknown;
    lock?: unknown;
}

/**
 * - lock-incomplete: 署名は正しいが、ワールドが実行し得る mod の一部が lock に固定されていない
 *   （または定義を解釈できない）。「作者署名あり ⇒ 全 mod のコードが固定されている」を保証するため無効扱い。
 */
export type WorldSignatureInvalidReason =
    | 'malformed'
    | 'name-mismatch'
    | 'content-mismatch'
    | 'bad-signature'
    | 'lock-incomplete';

export type WorldIdentityVerdict = WorldIdentity | { status: 'invalid'; reason: WorldSignatureInvalidReason };

export { type AuthorKeyCheck, type AuthorKeyCheckResult, canonicalJson, type WorldCrypto, type WorldSigningKey };

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
 * 一覧・検索に公開してよいか。署名を検証でき、かつ作者アカウント（どこかのサーバーに実在する
 * handle@domain）まで確認できたワールドだけを公開する。例外は無い（公式ワールドも公式アカウントで署名する）。
 * 未署名・鍵だけの署名（作者不明）・識別不明は、URL を直接知っている人だけが確認付きで入れる。
 */
export function isPublishable(identity: WorldIdentity | undefined): boolean {
    return identity?.status === 'verified' && !!identity.author;
}

/**
 * 署名対象のワールドで lock に固定されていない mod。定義を解釈できなければ null（固定を確認できない）。
 * lock は兄弟配信の値を優先し、無ければ埋め込み `spec.lock`。
 */
export function unpinnedModsOf(doc: WorldDocument): string[] | null {
    const parsed = WorldDefinitionSchema.safeParse(doc.definition);
    if (!parsed.success) return null;
    const rawLock = doc.lock ?? parsed.data.spec.lock ?? null;
    const lock = rawLock === null ? null : ModLockSchema.safeParse(rawLock);
    if (lock && !lock.success) return null;
    return unlockedModIds(parsed.data.spec, lock?.data);
}

/** 版をまたいで不変なワールド識別子（作者アカウント未確認時は鍵で識別する）。 */
export function worldIdOf(publicKey: string, name: string): string {
    return `ed25519:${publicKey}/${name}`;
}

/** 作者アカウントを確認できたワールドの識別子。鍵を入れ替えても変わらない。 */
export function authorWorldIdOf(author: string, name: string): string {
    return `acct:${author}/${name}`;
}

/** 他サーバーの作者の確認がこれより古ければ「確認が古い」と表示する（作者のサーバーが止まっている可能性）。 */
export const AUTHOR_CHECK_STALE_MS = 24 * 60 * 60 * 1000;

/** 作者の確認が古いか（作者のサーバーから鍵一覧を長く取り直せていない）。 */
export function isAuthorCheckStale(identity: WorldIdentity | undefined, now: number): boolean {
    if (identity?.status !== 'verified' || !identity.author || !identity.authorCheckedAt) return false;
    return now - Date.parse(identity.authorCheckedAt) > AUTHOR_CHECK_STALE_MS;
}

/** ワールドの署名の対象（共通の形式の `kind: 'world'`）。内容のハッシュは `{ definition, lock }` から求める。 */
async function worldTarget(doc: WorldDocument, crypto: WorldCrypto): Promise<SignatureTarget | undefined> {
    const name = worldNameOf(doc.definition);
    return name ? { kind: 'world', subject: name, contentHash: await worldContentHash(doc, crypto) } : undefined;
}

/** ワールドに作者アカウント付きで署名する（共通の形式。docs/PROTOCOLS.md）。 */
export async function signWorld(
    doc: WorldDocument,
    key: WorldSigningKey,
    crypto: WorldCrypto,
    options: { author: string },
): Promise<WorldSignature> {
    const target = await worldTarget(doc, crypto);
    if (!target) throw new Error('metadata.name が無いワールドには署名できません');
    return (await signEnvelope(target, key, options.author)) as WorldSignature;
}

const INVALID_REASON: Record<EnvelopeInvalidReason, WorldSignatureInvalidReason> = {
    malformed: 'malformed',
    'kind-mismatch': 'malformed',
    'subject-mismatch': 'name-mismatch',
    'content-mismatch': 'content-mismatch',
    'bad-signature': 'bad-signature',
};

/**
 * 署名を検証して識別結果を返す。`rawSignature` が null/undefined なら unsigned。
 * 照合の順番は共通の形式と同じ（形式 → 名前 → 内容 → 署名）で、そのあとに lock の固定を確かめ、最後に作者を確かめる。
 *
 * 作者は、署名鍵がその作者の有効な鍵だと `isAuthorKey` で確認できたときだけ採用する。確認できない・取り消し済み・判定器が無い
 * 場合は作者を付けず鍵で識別する（なりすましを表示しない）。署名自体は正しいので invalid にはしない。
 */
export async function verifyWorldSignature(
    doc: WorldDocument,
    rawSignature: unknown,
    crypto: WorldCrypto,
    isAuthorKey?: AuthorKeyCheck,
): Promise<WorldIdentityVerdict> {
    const contentHash = await worldContentHash(doc, crypto);
    if (rawSignature === null || rawSignature === undefined) return { status: 'unsigned', contentHash };
    const target = await worldTarget(doc, crypto);
    if (!target) return { status: 'invalid', reason: 'name-mismatch' };
    const verdict = await verifyEnvelope(rawSignature, target, crypto);
    if (verdict.status === 'missing') return { status: 'unsigned', contentHash };
    if (verdict.status === 'invalid') return { status: 'invalid', reason: INVALID_REASON[verdict.reason] };
    const unpinned = unpinnedModsOf(doc);
    if (unpinned === null || unpinned.length > 0) return { status: 'invalid', reason: 'lock-incomplete' };

    const { envelope } = verdict;
    const check = await confirmEnvelopeAuthor(envelope, isAuthorKey);
    if (check.status === 'confirmed') {
        return {
            status: 'verified',
            worldId: authorWorldIdOf(envelope.author, envelope.subject),
            publicKey: envelope.publicKey,
            contentHash,
            author: envelope.author,
            ...(check.checkedAt ? { authorCheckedAt: check.checkedAt } : {}),
        };
    }
    return {
        status: 'verified',
        worldId: worldIdOf(envelope.publicKey, envelope.subject),
        publicKey: envelope.publicKey,
        contentHash,
        ...(check.status === 'pending' ? { authorPending: true as const } : {}),
    };
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
