import type { WorldListItem } from '@ubichill/shared';

export interface LoadedFavorites {
    worlds: WorldListItem[];
    unavailable: string[];
}

/** 読み込み済みの結果から、いまもお気に入りのものだけを表示する（外した分は取り直さずに消す）。 */
export function visibleFavorites(loaded: LoadedFavorites, favorites: ReadonlySet<string>): LoadedFavorites {
    return {
        worlds: loaded.worlds.filter((w) => favorites.has(w.url)),
        unavailable: loaded.unavailable.filter((ref) => favorites.has(ref)),
    };
}
