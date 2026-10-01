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

/**
 * 取得を始めた時点のお気に入りに無いもの（追加された分）があるときだけ取り直す。
 * 外しただけなら取り直さない（取り直しは最大 100 件の解決になるため）。
 * サーバーは URL を正規化して返すので、返ってきたワールドの URL とは比べず、取得を依頼した URL の集合と比べる。
 */
export function needsReload(requested: ReadonlySet<string>, favorites: ReadonlySet<string>): boolean {
    return [...favorites].some((ref) => !requested.has(ref));
}
