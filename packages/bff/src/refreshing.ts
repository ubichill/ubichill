/**
 * core API から読むものを少しの間覚えておく（どのページの HTML にも入れるので、毎回 core API を待たせない）。
 * 古くなったら、覚えている値をすぐ返しつつ裏で読み直す。一度も読めていないときだけ、読み終わるのを待つ。
 * 読めなかったら retryMs の間は読みに行かない（core API が落ちている間、HTML を毎回待たせない）。
 */
export interface Refreshing<T> {
    get(): Promise<T | undefined>;
}

export function createRefreshing<T>({
    load,
    ttlMs,
    retryMs,
    now = Date.now,
}: {
    /** 読めなければ undefined か例外（覚えている値は捨てない） */
    load: () => Promise<T | undefined>;
    ttlMs: number;
    retryMs: number;
    now?: () => number;
}): Refreshing<T> {
    const state: {
        value: T | undefined;
        loadedAt: number;
        failedAt: number;
        inflight: Promise<T | undefined> | null;
    } = { value: undefined, loadedAt: Number.NEGATIVE_INFINITY, failedAt: Number.NEGATIVE_INFINITY, inflight: null };

    const refresh = (): Promise<T | undefined> => {
        if (state.inflight) return state.inflight;
        const inflight = load()
            .catch(() => undefined)
            .then((value) => {
                if (value === undefined) state.failedAt = now();
                else {
                    state.value = value;
                    state.loadedAt = now();
                }
                return state.value;
            })
            .finally(() => {
                state.inflight = null;
            });
        state.inflight = inflight;
        return inflight;
    };

    return {
        get() {
            const at = now();
            if (at - state.loadedAt < ttlMs || at - state.failedAt < retryMs) return Promise.resolve(state.value);
            const pending = refresh();
            return state.value === undefined ? pending : Promise.resolve(state.value);
        },
    };
}
