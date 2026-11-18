import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from '../../lib/api';

/**
 * お気に入りワールド（worldRef＝正規 URL の集合）のモジュール共有ストア。
 *
 * 複数のカード/モーダルが同時にお気に入りを表示するため、コンポーネントごとに
 * fetch せずモジュール singleton で 1 回だけ取得し、全 consumer を同期する。
 * トグルは楽観的更新し、失敗時はサーバー状態へ戻す。
 */
const store: { favorites: ReadonlySet<string>; loaded: boolean; inflight: Promise<void> | null } = {
    favorites: new Set(),
    loaded: false,
    inflight: null,
};
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlySet<string> {
    return store.favorites;
}

function load(force = false): Promise<void> {
    if (store.inflight) return store.inflight;
    if (store.loaded && !force) return Promise.resolve();
    const promise: Promise<void> = fetch(`${API_BASE}/api/v1/users/me/favorites`, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<{ worldRefs: string[] }>) : null))
        .then((data) => {
            // 読んでいる間にログアウトしていたら（resetFavorites）、前の人の一覧を入れない
            if (data && store.inflight === promise) {
                store.loaded = true;
                setFavorites(new Set(data.worldRefs));
            }
        })
        .catch(() => undefined)
        .finally(() => {
            if (store.inflight === promise) store.inflight = null;
        });
    store.inflight = promise;
    return promise;
}

function setFavorites(next: ReadonlySet<string>): void {
    store.favorites = next;
    emit();
}

/** ログアウトしたとき（次の人に前の人のお気に入りを使わない）。 */
export function resetFavorites(): void {
    store.inflight = null;
    store.loaded = false;
    setFavorites(new Set());
}

async function toggle(worldRef: string): Promise<void> {
    const willAdd = !store.favorites.has(worldRef);
    const next = new Set(store.favorites);
    if (willAdd) next.add(worldRef);
    else next.delete(worldRef);
    setFavorites(next); // 楽観的更新
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/me/favorites`, {
            method: willAdd ? 'POST' : 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ worldRef }),
        });
        if (!res.ok) throw new Error('failed');
        // サーバーは共有 URL を正規化して保存するので、保存された形も持つ（どちらの形でもお気に入り済みと表示する）
        const saved = willAdd ? ((await res.json().catch(() => ({}))) as { worldRef?: string }).worldRef : undefined;
        if (saved && saved !== worldRef) setFavorites(new Set([...store.favorites, saved]));
    } catch {
        const revert = new Set(store.favorites);
        if (willAdd) revert.delete(worldRef);
        else revert.add(worldRef);
        setFavorites(revert);
    }
}

export function useFavorites() {
    const set = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => {
        void load();
    }, []);
    return {
        favorites: set,
        isFavorite: (worldRef: string) => set.has(worldRef),
        toggle,
        refresh: () => load(true),
    };
}
