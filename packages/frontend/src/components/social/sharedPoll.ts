/**
 * 画面をまたいで 1 つだけ動く定期読み込み（フレンドの現在地）。見ている画面が 1 つでもある間だけ読み直し、
 * 画面を移っても前の答えをそのまま使う（新しく開いた画面ごとに全員分を取り直さない）。
 * 答えは持ち主（ログインしているユーザー）ごと。持ち主が変わったら前の答えは捨て、前の持ち主の遅れて届いた答えも使わない。
 */
export interface PollSnapshot<T> {
    owner: string | undefined;
    data: T | null;
    error: string | null;
}

export interface SharedPollOptions<T> {
    load(): Promise<T>;
    intervalMs: number;
    /** 新しい画面が開いたとき、これより古い答えなら読み直す */
    staleMs: number;
    now(): number;
    isHidden(): boolean;
    /** 見えるようになったら呼ぶ（外す関数を返す） */
    onVisible(callback: () => void): () => void;
}

export function createSharedPoll<T>(options: SharedPollOptions<T>) {
    const state = {
        snapshot: { owner: undefined, data: null, error: null } as PollSnapshot<T>,
        fetchedAt: Number.NEGATIVE_INFINITY,
        listeners: new Set<() => void>(),
        stop: undefined as (() => void) | undefined,
        inflight: undefined as { owner: string | undefined; promise: Promise<void> } | undefined,
    };
    const emit = () => {
        for (const listener of state.listeners) listener();
    };

    const reload = (): Promise<void> => {
        const owner = state.snapshot.owner;
        const inflight = state.inflight;
        if (inflight && inflight.owner === owner) return inflight.promise;
        const promise = options
            .load()
            .then(
                (data) => {
                    if (state.snapshot.owner !== owner) return;
                    state.snapshot = { owner, data, error: null };
                    state.fetchedAt = options.now();
                },
                (e: unknown) => {
                    if (state.snapshot.owner !== owner) return;
                    state.snapshot = {
                        ...state.snapshot,
                        error: e instanceof Error ? e.message : '読み込めませんでした',
                    };
                },
            )
            .finally(() => {
                if (state.inflight?.promise === promise) state.inflight = undefined;
                emit();
            });
        state.inflight = { owner, promise };
        return promise;
    };

    const start = () => {
        const timer = setInterval(() => {
            if (!options.isHidden()) void reload();
        }, options.intervalMs);
        const offVisible = options.onVisible(() => void reload());
        state.stop = () => {
            clearInterval(timer);
            offVisible();
        };
    };

    return {
        subscribe(listener: () => void): () => void {
            state.listeners.add(listener);
            if (state.listeners.size === 1) start();
            if (options.now() - state.fetchedAt >= options.staleMs) void reload();
            return () => {
                state.listeners.delete(listener);
                if (state.listeners.size === 0) {
                    state.stop?.();
                    state.stop = undefined;
                }
            };
        },
        getSnapshot: (): PollSnapshot<T> => state.snapshot,
        /** ログインしているユーザーを伝える。変わったら前の答えを捨てて読み直す */
        setOwner(owner: string | undefined): void {
            if (owner === state.snapshot.owner) return;
            state.snapshot = { owner, data: null, error: null };
            state.fetchedAt = Number.NEGATIVE_INFINITY;
            emit();
            if (state.listeners.size > 0) void reload();
        },
        reload,
    };
}
