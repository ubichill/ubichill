import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from '@/lib/api';

/**
 * お気に入りワールド（worldRef＝正規 URL の集合）のモジュール共有ストア。
 *
 * 複数のカード/モーダルが同時にお気に入りを表示するため、コンポーネントごとに
 * fetch せずモジュール singleton で 1 回だけ取得し、全 consumer を同期する。
 * トグルは楽観的更新し、失敗時はサーバー状態へ戻す。
 */
let favorites: ReadonlySet<string> = new Set();
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlySet<string> {
    return favorites;
}

function load(force = false): Promise<void> {
    if (inflight) return inflight;
    if (loaded && !force) return Promise.resolve();
    inflight = fetch(`${API_BASE}/api/v1/users/me/favorites`, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<{ worldRefs: string[] }>) : null))
        .then((data) => {
            if (data) {
                favorites = new Set(data.worldRefs);
                loaded = true;
                emit();
            }
        })
        .catch(() => undefined)
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

function setFavorites(next: ReadonlySet<string>): void {
    favorites = next;
    emit();
}

async function toggle(worldRef: string): Promise<void> {
    const willAdd = !favorites.has(worldRef);
    const next = new Set(favorites);
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
    } catch {
        const revert = new Set(favorites);
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
