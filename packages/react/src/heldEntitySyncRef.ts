/**
 * heldEntitySyncRef — 現在 hold 中のエンティティ状態をモジュールレベルで保持するシングルトン。
 *
 * 目的:
 *  - HoldContext は InstanceRenderer 内の HoldProvider ツリーに閉じている。
 *  - useBroadcastCursor / CursorLayer は HoldProvider の外側（router レベル）で動く。
 *  - React Context を越えてhold状態を伝えるため、module-level の変数を使う。
 *
 * 更新タイミング:
 *  - HoldContext.handleGripCommand が CMD_GRIP を受け取ったとき、内部で set() を呼ぶ。
 *
 * 読み取り:
 *  - useBroadcastCursor が cursor:move を送る直前に get() で読む。
 */

export interface HeldEntitySyncState {
    entityId: string;
    share: 'local' | 'presence' | 'persistent';
}

let _state: HeldEntitySyncState | null = null;

export const heldEntitySyncRef = {
    get(): HeldEntitySyncState | null {
        return _state;
    },
    set(state: HeldEntitySyncState | null): void {
        _state = state;
    },
};
