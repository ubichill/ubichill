/**
 * `Ubi.ui.render()` の自動再描画のための、最小限の依存追跡ユーティリティ。
 *
 * 設計: `Ubi.state` の各 `define()` インスタンスが、キーごとに安定した
 * {@link KeyDescriptor}（そのキー専用の subscribe/unsubscribe 閉包）を1個だけ生成して
 * 使い回す。`Ubi.ui.render` は factory() 実行中に読まれた descriptor の集合を集め、
 * 前回の集合との差分だけ subscribe/unsubscribe することで「読んだキーが変わった時だけ
 * 再実行される」を実現する（React 等の動的依存追跡と同じ発想）。
 *
 * `createReadTracker()` はスタック（同期実行中の「いま追跡中か」を覚えるだけの薄い状態）
 * のみを持つファクトリ。モジュールレベルのシングルトンにしない理由: `UbiSDK` は
 * インスタンスごとに独立した Worker（別 JS realm）で動くため実害は無いが、1つの JS realm に
 * 複数の `UbiSDK`（テストハーネス等）を作るケースで状態を共有してしまうのは設計として
 * 不必要な結合。`Ubi.ui`/`Ubi.state` と同じ deps 注入の作法に合わせ、`UbiSDK` の
 * コンストラクタで1個だけ生成し、両モジュールに配る。
 */
export interface KeyDescriptor {
    subscribe(targetId: string, onInvalidate: () => void): void;
    unsubscribe(targetId: string): void;
}

export interface ReadTracker {
    /** 追跡を開始する（ネスト呼び出しに備えてスタックを使う）。 */
    beginTrackingReads(): void;
    /** 追跡中であれば、読まれた descriptor を記録する（追跡中でなければ何もしない）。 */
    recordRead(descriptor: KeyDescriptor): void;
    /** 追跡を終え、今回読まれた descriptor の集合を返す。 */
    endTrackingReads(): Set<KeyDescriptor>;
}

export function createReadTracker(): ReadTracker {
    const trackingStack: Set<KeyDescriptor>[] = [];

    return {
        beginTrackingReads(): void {
            trackingStack.push(new Set());
        },
        recordRead(descriptor: KeyDescriptor): void {
            trackingStack[trackingStack.length - 1]?.add(descriptor);
        },
        endTrackingReads(): Set<KeyDescriptor> {
            return trackingStack.pop() ?? new Set();
        },
    };
}
