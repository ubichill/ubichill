/**
 * 入るたびの印（タイムアウト・失敗）。attempt は入るたびに変わる番号で、同じ部屋に入り直したときも変わる。
 * 前の入室の印は無いのと同じに読む。
 */
export interface EntryMark<T> {
    attempt: number;
    value: T;
}

/**
 * 今の入室の印を読む。部屋を移った最初の描画では、前の入室の印（25 秒たった・失敗した）がまだ state に残っているが、
 * それを今の入室のものとして読まない（読むと、入る前にタイムアウトで失敗にしてホームへ戻してしまう）。
 * 部屋の ID で比べると、A → B → A と 25 秒の内に戻ったとき、前に A で付いた印を読んでしまう。
 */
export const markFor = <T>(mark: EntryMark<T> | null, attempt: number): T | null =>
    mark !== null && mark.attempt === attempt ? mark.value : null;

/** 部屋の ID が変わるたびに入室の番号を進める（同じ部屋へ戻ったときも新しい番号になる）。 */
export function nextEntry(
    entry: { instanceId: string | undefined; attempt: number },
    instanceId: string | undefined,
): { instanceId: string | undefined; attempt: number } {
    return entry.instanceId === instanceId ? entry : { instanceId, attempt: entry.attempt + 1 };
}

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
