import type { WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { fetchMyFavoriteWorlds } from '@/lib/favoritesApi';
import { useFavorites } from './useFavorites';

interface FavoriteWorldsState {
    worlds: WorldListItem[];
    unavailable: string[];
    loading: boolean;
    error: string | null;
}

/**
 * お気に入りのワールドを URL から解決して取得する（外部ワールドも含む）。
 * ローカル・グローバルの一覧に無いワールドも出せるよう、一覧の絞り込みではなくサーバーに解決させる。
 * お気に入りが増減したら取り直す。
 */
export function useFavoriteWorlds(enabled: boolean) {
    const { favorites } = useFavorites();
    const [state, setState] = useState<FavoriteWorldsState>({
        worlds: [],
        unavailable: [],
        loading: false,
        error: null,
    });

    const reload = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const result = await fetchMyFavoriteWorlds();
            setState({ ...result, loading: false, error: null });
        } catch (e) {
            setState((prev) => ({
                ...prev,
                loading: false,
                error: e instanceof Error ? e.message : 'お気に入りを取得できませんでした',
            }));
        }
    }, []);

    useEffect(() => {
        void favorites;
        if (enabled) void reload();
    }, [enabled, favorites, reload]);

    return { ...state, reload };
}
