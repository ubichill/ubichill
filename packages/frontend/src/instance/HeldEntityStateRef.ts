/**
 * HeldEntityStateRef — 現在 hold 中のエンティティ状態をモジュールレベルで保持するシングルトン。
 *
 * 目的:
 *  - HoldContext は InstanceRenderer の内部 (HoldProvider) に閉じている。
 *  - useBroadcastCursor / CursorLayer は InstanceRenderer の外側（router レベル）で動く。
 *  - React Context を越えて hold 状態を伝えるため、module-level の ref を使う。
 *
 * 更新タイミング:
 *  - WorkerPluginHost の onGripCommand が CMD_GRIP を受け取ったとき
 *    → HoldContext.handleGripCommand() と同時に updateHeldState() を呼ぶ
 *
 * 読み取り:
 *  - useBroadcastCursor が cursor:move を送る直前に getHeldState() で読む
 */

export interface HeldEntityState {
    entityId: string;
    share: 'local' | 'presence' | 'persistent';
}

let _current: HeldEntityState | null = null;

/** hold 状態を更新する（WorkerPluginHost から呼ぶ） */
export function updateHeldState(state: HeldEntityState | null): void {
    _current = state;
}

/** 現在の hold 状態を取得する（useBroadcastCursor から呼ぶ） */
export function getHeldState(): HeldEntityState | null {
    return _current;
}
