/**
 * penFingerprint
 *
 * ストロークの重複コミット防止用フィンガープリント。
 * PenSyncSystem（自分のストロークを即座にコミット後に登録）と
 * PenCanvasSystem（entity:pen:stroke / pen:stroke_complete の受信時に照合）で共有する。
 */

import type { CanvasStrokeData } from '@ubichill/sdk';

/** フィンガープリントキャッシュの最大保持数 */
const MAX_FINGERPRINT_CACHE = 200;

/**
 * 既にコミット済みのストロークフィンガープリントを保持する Set。
 * - PenSyncSystem: 自分のストロークをローカルコミット後に add()
 * - PenCanvasSystem: broadcast / entity:watch 受信時に popIfExists() で照合
 */
const _committedFingerprints = new Set<string>();

/** ストロークを一意に識別するフィンガープリントを生成する。 */
export function strokeFingerprint(data: CanvasStrokeData): string {
    const p0 = data.points[0];
    return `${data.color}|${data.size}|${data.points.length}|${p0?.[0] ?? 0},${p0?.[1] ?? 0}`;
}

/**
 * コミット済みフィンガープリントを追加する。
 * キャッシュが上限に達した場合は最も古いエントリを削除する（LRU 的）。
 */
export function addCommittedFingerprint(fp: string): void {
    if (_committedFingerprints.size >= MAX_FINGERPRINT_CACHE) {
        const oldest = _committedFingerprints.values().next().value;
        if (oldest !== undefined) _committedFingerprints.delete(oldest);
    }
    _committedFingerprints.add(fp);
}

/**
 * フィンガープリントがコミット済みであれば Set から削除して true を返す。
 * 存在しない場合は false を返す。
 * "消費" することで entity:pen:stroke の二重コミットを防ぐ。
 */
export function popCommittedFingerprint(fp: string): boolean {
    if (_committedFingerprints.has(fp)) {
        _committedFingerprints.delete(fp);
        return true;
    }
    return false;
}
