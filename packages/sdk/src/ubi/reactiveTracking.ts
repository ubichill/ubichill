/**
 * `Ubi.ui.render()` の自動再描画のための、最小限の依存追跡ユーティリティ。
 *
 * 設計: `Ubi.state` の各 `define()` インスタンスが、キーごとに安定した
 * {@link KeyDescriptor}（そのキー専用の subscribe/unsubscribe 閉包）を1個だけ生成して
 * 使い回す。`Ubi.ui.render` は factory() 実行中に読まれた descriptor の集合を集め、
 * 前回の集合との差分だけ subscribe/unsubscribe することで「読んだキーが変わった時だけ
 * 再実行される」を実現する（React 等の動的依存追跡と同じ発想）。
 *
 * ここにはスタック（同期実行中の「いま追跡中か」を覚えるだけの薄い状態）以外の
 * ロジックは置かない。実際の購読先（listeners）は各 state インスタンス側が持つ。
 */
export interface KeyDescriptor {
    subscribe(targetId: string, onInvalidate: () => void): void;
    unsubscribe(targetId: string): void;
}

const trackingStack: Set<KeyDescriptor>[] = [];

/** 追跡を開始する（ネスト呼び出しに備えてスタックを使う）。 */
export function beginTrackingReads(): void {
    trackingStack.push(new Set());
}

/** 追跡中であれば、読まれた descriptor を記録する（追跡中でなければ何もしない）。 */
export function recordRead(descriptor: KeyDescriptor): void {
    trackingStack[trackingStack.length - 1]?.add(descriptor);
}

/** 追跡を終え、今回読まれた descriptor の集合を返す。 */
export function endTrackingReads(): Set<KeyDescriptor> {
    return trackingStack.pop() ?? new Set();
}
