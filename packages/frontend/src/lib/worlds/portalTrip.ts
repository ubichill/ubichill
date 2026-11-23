/**
 * ポータルで移る流れを、1 つのページで同時に 1 つだけにする。確認・行き先の確認（最長 30 秒）の間に押し直しても
 * 2 つ目は始めない。部屋を移った・ページを閉じたら、途中のものを取り消す（古い確認が通って今の部屋を出ないように）。
 */
export interface PortalTrips {
    /** 始める。もう始まっていれば null（押し直しは無視する） */
    begin(): AbortSignal | null;
    /** 終わった（移った・やめた・断られた）。取り消されたあとの古いものが終わっても、新しいものを消さない */
    end(signal: AbortSignal): void;
    /** 途中のものを取り消す（部屋を移った・ページを閉じた） */
    cancel(): void;
}

export function createPortalTrips(): PortalTrips {
    const state: { current: AbortController | null } = { current: null };
    return {
        begin() {
            if (state.current) return null;
            state.current = new AbortController();
            return state.current.signal;
        },
        end(signal) {
            if (state.current?.signal === signal) state.current = null;
        },
        cancel() {
            state.current?.abort();
            state.current = null;
        },
    };
}
