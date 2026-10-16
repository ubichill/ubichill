/**
 * mod の作者署名の生成・検証（純粋ロジック）。
 *
 * 鍵・作者アカウント・作者の確認（{@link AuthorKeyCheck}）・暗号の注入（{@link WorldCrypto}）はワールドの署名と共通。
 * 違いは 2 つ: 署名対象は mod の lock（実行するコードと権限の上限を決める部分）、作者アカウントは必須。
 * 署名の無い mod・作者を確認できない mod は実行しない（ワールドの置き場所・mod の置き場所で緩めない）。
 */
import type { ModLockEntry } from '../schemas/modLock.schema';
import {
    confirmEnvelopeAuthor,
    type EnvelopeInvalidReason,
    type ModSignature,
    type SignatureTarget,
    signEnvelope,
    verifyEnvelope,
} from '../signature/envelope';
import { type AuthorKeyCheck, canonicalJson, type WorldCrypto, type WorldSigningKey } from '../world/identity';
import { formatIntegrity } from './modLock';

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

/**
 * mod の作者を第三者（Ubichill のサーバー）に確かめ直してもらうための材料。Host が読み込み時に確認できた lock と署名。
 * 受け取った側は {@link verifyModSignature} で確かめ直す（Host の申告をそのまま信じない）。
 */
export interface ModAuthorProof {
    entry: ModLockEntry;
    signature: unknown;
}

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

/** mod の署名の対象（共通の形式の `kind: 'mod'`）。版は lock の内容にも入るが、取り違えを防ぐため対象の版として明示する。 */
async function modTarget(entry: ModLockEntry, crypto: WorldCrypto): Promise<SignatureTarget> {
    return {
        kind: 'mod',
        subject: entry.id,
        subjectVersion: entry.version,
        contentHash: await modContentHash(entry, crypto),
    };
}

/** mod に作者アカウント付きで署名する（共通の形式。docs/PROTOCOLS.md）。 */
export async function signMod(
    entry: ModLockEntry,
    key: WorldSigningKey,
    crypto: WorldCrypto,
    options: { author: string },
): Promise<ModSignature> {
    return (await signEnvelope(await modTarget(entry, crypto), key, options.author)) as ModSignature;
}

const rejected = (reason: ModSignatureRejectReason): ModSignatureVerdict => ({ status: 'rejected', reason });

const INVALID_REASON: Record<EnvelopeInvalidReason, ModSignatureRejectReason> = {
    malformed: 'signature-malformed',
    'kind-mismatch': 'signature-malformed',
    'subject-mismatch': 'signature-mod-mismatch',
    'content-mismatch': 'signature-content-mismatch',
    'bad-signature': 'signature-invalid',
};

/**
 * lock（ワールドが固定した mod の項目）に対して署名を検証する。`rawSignature` が null/undefined なら signature-missing。
 * 照合の順番は共通の形式と同じ。作者を確かめられなければ実行しない（鍵だけの署名では動かさない）。
 */
export async function verifyModSignature(
    entry: ModLockEntry,
    rawSignature: unknown,
    crypto: WorldCrypto,
    isAuthorKey?: AuthorKeyCheck,
): Promise<ModSignatureVerdict> {
    const verdict = await verifyEnvelope(rawSignature, await modTarget(entry, crypto), crypto);
    if (verdict.status === 'missing') return rejected('signature-missing');
    if (verdict.status === 'invalid') return rejected(INVALID_REASON[verdict.reason]);
    const { envelope } = verdict;
    const check = await confirmEnvelopeAuthor(envelope, isAuthorKey);
    if (check.status === 'pending') return rejected('author-pending');
    if (check.status !== 'confirmed') return rejected('author-unconfirmed');
    return {
        status: 'verified',
        author: envelope.author,
        publicKey: envelope.publicKey,
        contentHash: envelope.contentHash,
        ...(check.checkedAt ? { authorCheckedAt: check.checkedAt } : {}),
    };
}
