import { useResolvedFavorites } from '@/lib/favorites/useResolvedFavorites';
import { fetchMyFavoriteWorlds } from '@/lib/worlds/favoritesApi';
import { type LoadedFavorites, visibleFavorites } from './favoriteWorldsView';
import { useFavorites } from './useFavorites';

const EMPTY: LoadedFavorites = { worlds: [], unavailable: [] };

/**
 * お気に入りのワールドを URL から解決して取得する（外部ワールドも含む）。
 * ローカル・グローバルの一覧に無いワールドも出せるよう、一覧の絞り込みではなくサーバーに解決させる。
 */
export function useFavoriteWorlds(enabled: boolean) {
    const { favorites } = useFavorites();
    const { view, ...state } = useResolvedFavorites({
        enabled,
        favorites,
        fetchResolved: fetchMyFavoriteWorlds,
        visible: visibleFavorites,
        empty: EMPTY,
        failure: 'お気に入りを取得できませんでした',
    });
    return { ...view, ...state };
}
