/**
 * 1 つの決定（承認画面の結果など）を複数の依頼で待つ。待っている依頼がすべて取り消したら onAbandon を呼ぶ。
 * signal を渡さない依頼は取り消せないので、その依頼がいる限り決定を待ち続ける。
 */
export function createSharedWait<T>(
    decision: Promise<T>,
    abandonedValue: T,
    onAbandon: () => void,
): (signal?: AbortSignal) => Promise<T> {
    const state = { waiters: 0, settled: false };
    void decision.then(() => {
        state.settled = true;
    });
    return (signal) => {
        if (signal?.aborted) return Promise.resolve(abandonedValue);
        state.waiters += 1;
        return new Promise<T>((resolve) => {
            const leave = () => {
                state.waiters -= 1;
                resolve(abandonedValue);
                if (state.waiters === 0 && !state.settled) onAbandon();
            };
            signal?.addEventListener('abort', leave, { once: true });
            void decision.then((value) => {
                signal?.removeEventListener('abort', leave);
                resolve(value);
            });
        });
    };
}
