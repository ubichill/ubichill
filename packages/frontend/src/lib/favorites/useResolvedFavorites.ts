import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 取得を始めた時点のお気に入りに無いもの（追加された分）があるときだけ取り直す。
 * 外しただけなら取り直さない（取り直しは最大 100 件の解決になるため）。
 * サーバーは鍵を正規化して返すことがあるので、返ってきた中身とは比べず、取得を依頼した時点の鍵の集合と比べる。
 */
export function needsReload(requested: ReadonlySet<string>, favorites: ReadonlySet<string>): boolean {
    return [...favorites].some((key) => !requested.has(key));
}

interface LoadState<T> {
    result: T;
    /** 取得を依頼した時点のお気に入り（追加された分の判定に使う）。 */
    requested: ReadonlySet<string>;
}

/**
 * お気に入りをサーバーに解決させた一覧（ワールド・mod）。取り直すのは、読み込み済みに無いお気に入りが増えたときだけ
 * （外した分は visible で表示から消すだけ）。古い応答が新しい応答を上書きしないよう、最後に始めた取得の結果だけを使う。
 * fetchResolved・visible はモジュールの関数のように変わらないものを渡す。
 */
export function useResolvedFavorites<T>(options: {
    enabled: boolean;
    favorites: ReadonlySet<string>;
    fetchResolved: () => Promise<T>;
    visible: (loaded: T, favorites: ReadonlySet<string>) => T;
    empty: T;
    failure: string;
}) {
    const { enabled, favorites, fetchResolved, visible, empty, failure } = options;
    const [loaded, setLoaded] = useState<LoadState<T> | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const latestRequest = useRef(0);

    const favoritesRef = useRef(favorites);
    favoritesRef.current = favorites;

    const reload = useCallback(async () => {
        latestRequest.current += 1;
        const request = latestRequest.current;
        const requested = favoritesRef.current;
        setLoading(true);
        setError(null);
        try {
            const result = await fetchResolved();
            if (request !== latestRequest.current) return;
            setLoaded({ result, requested });
        } catch (e) {
            if (request !== latestRequest.current) return;
            setError(e instanceof Error ? e.message : failure);
        } finally {
            if (request === latestRequest.current) setLoading(false);
        }
    }, [fetchResolved, failure]);

    useEffect(() => {
        if (!enabled) return;
        if (loaded === null || needsReload(loaded.requested, favorites)) void reload();
    }, [enabled, favorites, loaded, reload]);

    const view = useMemo(() => visible(loaded?.result ?? empty, favorites), [loaded, favorites, visible, empty]);
    return { view, loading, error, reload };
}
