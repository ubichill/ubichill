/**
 * mod の作者署名の生成・検証（純粋ロジック）。
 *
 * 鍵・作者アカウント・作者の確認（{@link AuthorKeyCheck}）・暗号の注入（{@link WorldCrypto}）はワールドの署名と共通。
 * 違いは 2 つ: 署名対象は mod の lock（実行するコードと権限の上限を決める部分）、作者アカウントは必須。
 * 署名の無い mod・作者を確認できない mod は実行しない（ワールドの置き場所・mod の置き場所で緩めない）。
 */
import type { ModLockEntry } from '../schemas/modLock.schema';
import { type ModSignature, ModSignatureSchema } from '../schemas/modSignature.schema';
import {
    type AuthorKeyCheck,
    type AuthorKeyCheckResult,
    canonicalJson,
    type WorldCrypto,
    type WorldSigningKey,
} from '../world/identity';
import { formatIntegrity, integrityEquals } from './modLock';

/**
 * - signature-missing: 署名ファイルが無い
 * - signature-malformed: 形式が違う（作者アカウントの無い署名を含む）
 * - signature-mod-mismatch: 別の mod・別の版の署名
 * - signature-content-mismatch: 署名された内容と lock が違う
 * - signature-invalid: 署名が鍵と合わない
 * - author-unconfirmed: 署名鍵が作者の有効な鍵ではない（一覧に無い・取り消し済み・アカウントが無い）
 * - author-pending: いまは作者を確認できない（時間をおいて確認し直す）
 */
export type ModSignatureRejectReason =
    | 'signature-missing'
    | 'signature-malformed'
    | 'signature-mod-mismatch'
    | 'signature-content-mismatch'
    | 'signature-invalid'
    | 'author-unconfirmed'
    | 'author-pending';

export type ModSignatureVerdict =
    | {
          status: 'verified';
          /** 確認できた作者アカウント（`handle@domain`）。 */
          author: string;
          publicKey: string;
          contentHash: string;
          /** 他サーバーの作者の鍵一覧を最後に確認できた時刻（ワールドの署名と同じ）。 */
          authorCheckedAt?: string;
      }
    | { status: 'rejected'; reason: ModSignatureRejectReason };

/**
 * lock のうち署名する部分。実行するコード（manifest・worker の hash）と権限の上限を決める項目だけを取り出す。
 * `baseUrl`（置き場所）は含めない。同じ配布物をどこに置いても同じ署名で確かめられる。
 */
export function modLockContent(entry: ModLockEntry): unknown {
    return {
        id: entry.id,
        version: entry.version,
        manifestIntegrity: entry.manifestIntegrity,
        components: Object.fromEntries(
            Object.entries(entry.components).map(([type, c]) => [
                type,
                { workerUrl: c.workerUrl, integrity: c.integrity, capabilities: [...c.capabilities] },
            ]),
        ),
    };
}

export async function modContentHash(entry: ModLockEntry, crypto: WorldCrypto): Promise<string> {
    return formatIntegrity(await crypto.sha256Base64(canonicalJson(modLockContent(entry))));
}

/** 署名対象のバイト列。signature 以外の全フィールドを正規化する。 */
export function modSignaturePayload(fields: Omit<ModSignature, 'signature'>): string {
    return canonicalJson({
        version: fields.version,
        alg: fields.alg,
        kind: fields.kind,
        publicKey: fields.publicKey,
        name: fields.name,
        modVersion: fields.modVersion,
        contentHash: fields.contentHash,
        author: fields.author,
    });
}

export async function signMod(
    entry: ModLockEntry,
    key: WorldSigningKey,
    crypto: WorldCrypto,
    options: { author: string },
): Promise<ModSignature> {
    const fields = {
        version: 1 as const,
        alg: 'ed25519' as const,
        kind: 'mod' as const,
        publicKey: key.publicKey,
        name: entry.id,
        modVersion: entry.version,
        contentHash: await modContentHash(entry, crypto),
        author: options.author,
    };
    return { ...fields, signature: await key.sign(modSignaturePayload(fields)) };
}

const rejected = (reason: ModSignatureRejectReason): ModSignatureVerdict => ({ status: 'rejected', reason });

/**
 * lock（ワールドが固定した mod の項目）に対して署名を検証する。`rawSignature` が null/undefined なら signature-missing。
 * 照合順: 形式 → mod の ID と版 → 内容 → 署名 → 作者。安価な判定を先に行い、作者の確認（他サーバーへの問い合わせ）は最後。
 * `isAuthorKey` を渡さなければ作者を確認できないので author-unconfirmed（鍵だけの署名では実行しない）。
 */
export async function verifyModSignature(
    entry: ModLockEntry,
    rawSignature: unknown,
    crypto: WorldCrypto,
    isAuthorKey?: AuthorKeyCheck,
): Promise<ModSignatureVerdict> {
    if (rawSignature === null || rawSignature === undefined) return rejected('signature-missing');
    const parsed = ModSignatureSchema.safeParse(rawSignature);
    if (!parsed.success) return rejected('signature-malformed');
    const sig = parsed.data;

    if (sig.name !== entry.id || sig.modVersion !== entry.version) return rejected('signature-mod-mismatch');
    const contentHash = await modContentHash(entry, crypto);
    if (!integrityEquals(sig.contentHash, contentHash)) return rejected('signature-content-mismatch');

    const ok = await crypto.verifyEd25519(sig.publicKey, modSignaturePayload(sig), sig.signature).catch(() => false);
    if (!ok) return rejected('signature-invalid');

    const check: AuthorKeyCheckResult = isAuthorKey
        ? await isAuthorKey(sig.author, sig.publicKey, contentHash).catch(() => ({ status: 'pending' }) as const)
        : { status: 'unconfirmed' };
    if (check.status === 'pending') return rejected('author-pending');
    if (check.status !== 'confirmed') return rejected('author-unconfirmed');
    return {
        status: 'verified',
        author: sig.author,
        publicKey: sig.publicKey,
        contentHash,
        ...(check.checkedAt ? { authorCheckedAt: check.checkedAt } : {}),
    };
}
