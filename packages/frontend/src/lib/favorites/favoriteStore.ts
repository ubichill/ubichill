import { useEffect, useSyncExternalStore } from 'react';

export interface FavoriteStoreApi {
    /** お気に入りの鍵の一覧。読めなければ undefined（ログインしていないなど）。 */
    load: () => Promise<readonly string[] | undefined>;
    /** 足す。サーバーが鍵を正規化して保存したら、その形を返す。失敗は throw。 */
    add: (key: string) => Promise<string | undefined>;
    /** 外す。失敗は throw。 */
    remove: (key: string) => Promise<void>;
    /** 反映できなかったとき（表示は元に戻す）。 */
    onError?: (error: unknown, adding: boolean) => void;
}

/**
 * お気に入り（鍵の集合）のモジュール共有ストア。
 *
 * 複数のカード・行・画面が同時にお気に入りを表示するため、コンポーネントごとに fetch せず 1 回だけ取得し、全員を同期する。
 * トグルは楽観的に更新し、失敗したらサーバーの状態へ戻す。ログアウト（reset）の前に始めた読み込み・トグルは、後から届いても反映しない。
 */
export function createFavoriteStore(api: FavoriteStoreApi) {
    const store: {
        favorites: ReadonlySet<string>;
        loaded: boolean;
        inflight: Promise<void> | null;
        generation: number;
    } = { favorites: new Set(), loaded: false, inflight: null, generation: 0 };
    const listeners = new Set<() => void>();

    const setFavorites = (next: ReadonlySet<string>): void => {
        store.favorites = next;
        for (const listener of listeners) listener();
    };
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };
    const getSnapshot = () => store.favorites;

    const load = (force = false): Promise<void> => {
        if (store.inflight) return store.inflight;
        if (store.loaded && !force) return Promise.resolve();
        const promise: Promise<void> = api
            .load()
            .then((keys) => {
                // 読んでいる間にログアウトしていたら（reset）、前の人の一覧を入れない
                if (keys && store.inflight === promise) {
                    store.loaded = true;
                    setFavorites(new Set(keys));
                }
            })
            .catch(() => undefined)
            .finally(() => {
                if (store.inflight === promise) store.inflight = null;
            });
        store.inflight = promise;
        return promise;
    };

    const reset = (): void => {
        store.generation += 1;
        store.inflight = null;
        store.loaded = false;
        setFavorites(new Set());
    };

    const toggle = async (key: string): Promise<void> => {
        const generation = store.generation;
        const adding = !store.favorites.has(key);
        setFavorites(
            adding ? new Set([...store.favorites, key]) : new Set([...store.favorites].filter((k) => k !== key)),
        );
        try {
            const saved = adding ? await api.add(key) : await api.remove(key).then(() => undefined);
            // 保存された形も持つ（どちらの形でもお気に入り済みと表示する）
            if (generation === store.generation && saved && saved !== key)
                setFavorites(new Set([...store.favorites, saved]));
        } catch (error) {
            if (generation !== store.generation) return;
            setFavorites(
                adding ? new Set([...store.favorites].filter((k) => k !== key)) : new Set([...store.favorites, key]),
            );
            api.onError?.(error, adding);
        }
    };

    function useFavoriteStore() {
        const favorites = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
        useEffect(() => {
            void load();
        }, []);
        return {
            favorites,
            isFavorite: (key: string) => favorites.has(key),
            toggle,
            refresh: () => load(true),
        };
    }

    return { useStore: useFavoriteStore, reset, toggle };
}
