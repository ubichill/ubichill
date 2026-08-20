/**
 * ridingSyncRef — 現在「乗って」いる乗り物の状態をモジュールレベルで保持するシングルトン。
 *
 * 目的:
 *  - RideContext は InstanceRenderer 内の RideProvider ツリーに閉じている。
 *  - useBroadcastCursor / useRideFollow は RideProvider の外側（router レベル）で動く
 *    (heldEntitySyncRef と同じ制約。詳細はそちらの docstring 参照)。
 *  - React Context を越えて riding 状態を伝えるため、module-level の変数を使う。
 *
 * 更新タイミング:
 *  - RideContext.handleRideCommand が CMD_RIDE を受け取ったとき、内部で set() を呼ぶ。
 *
 * 読み取り:
 *  - useBroadcastCursor が cursor:move を送る直前に get() で読む(乗車中は送らない)。
 *  - useRideFollow の requestAnimationFrame ループが毎フレーム get() で読む。
 */

export interface RidingSyncState {
    entityId: string;
}

let _state: RidingSyncState | null = null;
const listeners = new Set<() => void>();

export const ridingSyncRef = {
    get(): RidingSyncState | null {
        return _state;
    },
    set(state: RidingSyncState | null): void {
        if (_state?.entityId === state?.entityId) return;
        _state = state;
        for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};
