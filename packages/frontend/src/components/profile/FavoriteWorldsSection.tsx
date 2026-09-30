import type { WorldListItem } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { WorldCard } from '@/components/lobby/WorldCard';
import { WorldDetailModal } from '@/components/lobby/WorldDetailModal';
import { fetchUserFavoriteWorlds } from '@/lib/favoritesApi';
import { css } from '@/styled-system/css';

interface FavoriteWorldsSectionProps {
    userId: string;
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
}

/**
 * ユーザーのお気に入りのワールド（公開）。本人以外も見られる。作者まで確認できたワールドだけが出る。
 * 選ぶとワールドの詳細からインスタンスを作成・参加できる（外部ワールドも URL で解決する）。
 */
export function FavoriteWorldsSection({ userId, onJoinInstance }: FavoriteWorldsSectionProps) {
    const [worlds, setWorlds] = useState<WorldListItem[] | null>(null);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState<WorldListItem | null>(null);

    useEffect(() => {
        const state = { cancelled: false };
        setWorlds(null);
        setError('');
        fetchUserFavoriteWorlds(userId)
            .then((list) => {
                if (!state.cancelled) setWorlds(list);
            })
            .catch((e: unknown) => {
                if (!state.cancelled) setError(e instanceof Error ? e.message : 'お気に入りを取得できませんでした');
            });
        return () => {
            state.cancelled = true;
        };
    }, [userId]);

    return (
        <section className={css({ mt: '8' })}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '3' })}>
                お気に入りのワールド
                {worlds && worlds.length > 0 && (
                    <span className={css({ ml: '2', fontSize: '13px', fontWeight: '500', color: 'textMuted' })}>
                        {worlds.length}
                    </span>
                )}
            </h2>
            {error ? (
                <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>
            ) : worlds === null ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
            ) : worlds.length === 0 ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>公開しているお気に入りはありません。</p>
            ) : (
                <div
                    className={css({
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                        gap: '16px',
                    })}
                >
                    {worlds.map((world) => (
                        <WorldCard key={world.url} world={world} onSelect={setSelected} />
                    ))}
                </div>
            )}
            {selected && (
                <WorldDetailModal
                    worldId={selected.id}
                    initialWorld={selected}
                    onClose={() => setSelected(null)}
                    onJoinInstance={onJoinInstance}
                />
            )}
        </section>
    );
}
