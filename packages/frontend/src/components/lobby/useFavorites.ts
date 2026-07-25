import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';

/**
 * お気に入りワールド（worldRef＝正規 URL の集合）を管理するフック。
 * 楽観的更新でトグルし、失敗時はサーバー状態に戻す。
 */
export function useFavorites() {
    const [favorites, setFavorites] = useState<Set<string>>(new Set());

    const refresh = useCallback(() => {
        void fetch(`${API_BASE}/api/v1/users/me/favorites`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<{ worldRefs: string[] }>) : null))
            .then((data) => {
                if (data) setFavorites(new Set(data.worldRefs));
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const isFavorite = useCallback((worldRef: string) => favorites.has(worldRef), [favorites]);

    const toggle = useCallback(
        async (worldRef: string): Promise<void> => {
            const willAdd = !favorites.has(worldRef);
            // 楽観的更新
            setFavorites((prev) => {
                const next = new Set(prev);
                if (willAdd) next.add(worldRef);
                else next.delete(worldRef);
                return next;
            });
            try {
                const res = await fetch(`${API_BASE}/api/v1/users/me/favorites`, {
                    method: willAdd ? 'POST' : 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ worldRef }),
                });
                if (!res.ok) throw new Error('failed');
            } catch {
                // 失敗したら元に戻す
                setFavorites((prev) => {
                    const next = new Set(prev);
                    if (willAdd) next.delete(worldRef);
                    else next.add(worldRef);
                    return next;
                });
            }
        },
        [favorites],
    );

    return { favorites, isFavorite, toggle, refresh };
}
