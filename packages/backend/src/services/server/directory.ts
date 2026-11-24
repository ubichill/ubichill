/**
 * 検索に出してよい人の ID（BFF の sitemap.xml）。本番だけ出す。ログインしなくても読めるので、毎回 DB を引かずに覚えておく。
 */
export interface DirectoryDeps {
    /** 検索に出してよい人の ID（limit 人まで） */
    listHandles(limit: number): Promise<string[]>;
    /** 検索に載せてよい環境か（shared の isIndexableEnvironment） */
    indexable: boolean;
    limit: number;
    ttlMs: number;
    now?: () => number;
}

export type Directory = ReturnType<typeof createDirectory>;

export function createDirectory(deps: DirectoryDeps) {
    const now = deps.now ?? Date.now;
    const cache: { handles: string[] | null; loadedAt: number; inflight: Promise<string[]> | null } = {
        handles: null,
        loadedAt: Number.NEGATIVE_INFINITY,
        inflight: null,
    };

    const load = (): Promise<string[]> => {
        if (cache.inflight) return cache.inflight;
        const inflight = deps
            .listHandles(deps.limit)
            .then((handles) => {
                cache.handles = handles;
                cache.loadedAt = now();
                return handles;
            })
            .finally(() => {
                cache.inflight = null;
            });
        cache.inflight = inflight;
        return inflight;
    };

    return {
        /** 本番でなければ null（出さない）。 */
        async handles(): Promise<string[] | null> {
            if (!deps.indexable) return null;
            if (cache.handles && now() - cache.loadedAt < deps.ttlMs) return cache.handles;
            return load();
        },
    };
}
