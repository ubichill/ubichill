import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMyFavoriteWorlds } from '@/lib/favoritesApi';
import { type LoadedFavorites, needsReload, visibleFavorites } from './favoriteWorldsView';
import { useFavorites } from './useFavorites';

const EMPTY: LoadedFavorites = { worlds: [], unavailable: [] };

interface LoadState {
    result: LoadedFavorites;
    /** 取得を依頼した時点のお気に入り（追加された分の判定に使う）。 */
    requested: ReadonlySet<string>;
}

/**
 * お気に入りのワールドを URL から解決して取得する（外部ワールドも含む）。
 * ローカル・グローバルの一覧に無いワールドも出せるよう、一覧の絞り込みではなくサーバーに解決させる。
 * 取り直すのは、読み込み済みに無いお気に入りが増えたときだけ（外した分は表示から消すだけ）。
 * 古い応答が新しい応答を上書きしないよう、最後に始めた取得の結果だけを使う。
 */
export function useFavoriteWorlds(enabled: boolean) {
    const { favorites } = useFavorites();
    const [loaded, setLoaded] = useState<LoadState | null>(null);
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
            const result = await fetchMyFavoriteWorlds();
            if (request !== latestRequest.current) return;
            setLoaded({ result, requested });
        } catch (e) {
            if (request !== latestRequest.current) return;
            setError(e instanceof Error ? e.message : 'お気に入りを取得できませんでした');
        } finally {
            if (request === latestRequest.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;
        if (loaded === null || needsReload(loaded.requested, favorites)) void reload();
    }, [enabled, favorites, loaded, reload]);

    const view = useMemo(() => visibleFavorites(loaded?.result ?? EMPTY, favorites), [loaded, favorites]);
    return { ...view, loading, error, reload };
}
