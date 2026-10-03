/**
 * modLock — mod 完全性ロックの純粋ロジック。
 *
 * fetch / crypto（副作用）は呼び出し側（フロント loader・build スクリプト）が担い、
 * ここは「provenance からの enforcement 判定」と「計算済み digest の照合」だけを
 * 純関数で提供する。これによりロジックを crypto/fetch なしで意地悪にテストできる。
 *
 * 信頼モデル: lock はワールド YAML に埋め込まれ、ワールド URL の provenance が
 * 信頼根になる。capability は lock を天井とし、manifest（配布者の自己申告）を
 * 一切参照しない。コードバイト列が lock と一致する以上、真の必要権限＝lock。
 */
import type { ModLockComponent, ModLockEntry } from '../schemas/modLock.schema';

/** integrity（`sha256-<base64>`）を base64 digest から組み立てる。 */
export function formatIntegrity(base64Digest: string): string {
    return `sha256-${base64Digest}`;
}

/**
 * integrity 文字列の一致判定。
 * 前後空白を無視した完全一致のみ許す（アルゴリズム混在や部分一致は不許可）。
 */
export function integrityEquals(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    return a.trim() === b.trim();
}

/** {@link resolveLockedMod} が返す拒否理由。 */
export type LockRejectReason =
    /** lock にこの mod/component の記載が無い（置き場所に関係なく、lock に固定されていない mod は実行しない）。 */
    | 'lock-missing'
    /** worker バイト列が lock の integrity と一致しない。 */
    | 'integrity-mismatch'
    /** versioned manifest が lock の manifestIntegrity と一致しない。 */
    | 'manifest-mismatch';

/**
 * lock 検証の判定。どのワールドでも同じ規則（置き場所で緩めない）。
 * - `verified` : lock 記載あり＋バイト列一致。capabilities は lock 天井を採用する。
 * - `rejected` : lock に記載なし、または hash 不一致。実行しない。
 */
export type LockVerdict =
    | { status: 'verified'; capabilities: readonly string[] }
    | { status: 'rejected'; reason: LockRejectReason };

export interface ResolveLockedModArgs {
    /** `modId:componentName`。 */
    entityType: string;
    /** ワールドの lock からこの mod を引いたエントリ（無ければ undefined）。 */
    lockEntry: ModLockEntry | undefined;
    /** 計算済みの worker バイト列 integrity（`sha256-<base64>`）。 */
    workerIntegrity: string;
    /** 計算済みの versioned manifest integrity（`sha256-<base64>`）。 */
    manifestIntegrity: string;
}

/**
 * lock に対して mod を検証する純関数。fetch/crypto は呼び出し側で済ませて渡す。
 *
 * 判定順（どのワールドでも同じ。本体のワールドだけ緩めることはしない）:
 *  1. lock 記載が無い → 'lock-missing'。
 *  2. manifest hash 不一致 → 'manifest-mismatch'。
 *  3. worker hash 不一致 → 'integrity-mismatch'。
 *  4. 全一致 → verified（capabilities は lock 由来のみ＝天井）。
 *
 * workerUrl は loader が lock/manifest から持つのでここでは返さない。
 */
export function resolveLockedMod(args: ResolveLockedModArgs): LockVerdict {
    const { entityType, lockEntry, workerIntegrity, manifestIntegrity } = args;

    const component: ModLockComponent | undefined = lockEntry?.components[entityType];

    if (!lockEntry || !component) return { status: 'rejected', reason: 'lock-missing' };

    if (!integrityEquals(manifestIntegrity, lockEntry.manifestIntegrity)) {
        return { status: 'rejected', reason: 'manifest-mismatch' };
    }
    if (!integrityEquals(workerIntegrity, component.integrity)) {
        return { status: 'rejected', reason: 'integrity-mismatch' };
    }

    return { status: 'verified', capabilities: component.capabilities };
}
