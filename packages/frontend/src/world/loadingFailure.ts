/** 部屋ごとの印（タイムアウト・失敗）。別の部屋の印は無いのと同じに読む。 */
export interface RoomMark<T> {
    instanceId: string | undefined;
    value: T;
}

/**
 * 今の部屋の印を読む。部屋を移った最初の描画では、前の部屋の印（25 秒たった・失敗した）がまだ state に残っているが、
 * それを移った先の部屋のものとして読まない（読むと、入る前にタイムアウトで失敗にしてホームへ戻してしまう）。
 */
export const markFor = <T>(mark: RoomMark<T> | null, instanceId: string | undefined): T | null =>
    mark !== null && mark.instanceId === instanceId ? mark.value : null;

export const TIMEOUT_MESSAGE = 'インスタンスへの接続がタイムアウトしました';

/** 読み込みの失敗の理由。入れた（join 済み）なら、mod や Worker が揃わなくても失敗にしない。 */
export function loadingFailure(state: {
    error: string | null;
    isJoined: boolean;
    isConnecting: boolean;
    timedOut: boolean;
    complete: boolean;
}): string | null {
    if (state.error && !state.isJoined) return state.error;
    if (state.timedOut && !state.complete && !state.isJoined && !state.isConnecting) return TIMEOUT_MESSAGE;
    return null;
}
