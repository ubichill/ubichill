import type { FavoritesVisibility, WorldListItem } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { WorldCard } from '@/components/lobby/WorldCard';
import { WorldDetailModal } from '@/components/lobby/WorldDetailModal';
import { setMyFavoritesVisibility } from '@/lib/account/me';
import { fetchUserFavorites } from '@/lib/favoritesApi';
import { css } from '@/styled-system/css';
import { FavoritesVisibilityPicker } from './FavoritesVisibilityPicker';

interface FavoriteWorldsSectionProps {
    userId: string;
    /** 自分のプロフィール（公開範囲を変えられる）。 */
    isOwnPage: boolean;
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
}

type FavoritesState =
    | { status: 'loading' }
    | { status: 'hidden' }
    | { status: 'error'; message: string }
    | { status: 'visible'; worlds: WorldListItem[]; visibility: FavoritesVisibility };

/**
 * ユーザーのお気に入りのワールド。公開範囲（Private / Friends / Public）に従い、見てよい人にだけ出る。
 * 本人は公開範囲をここで変えられる。選ぶとワールドの詳細からインスタンスを作成・参加できる（外部ワールドも URL で解決する）。
 */
export function FavoriteWorldsSection({ userId, isOwnPage, onJoinInstance }: FavoriteWorldsSectionProps) {
    const [state, setState] = useState<FavoritesState>({ status: 'loading' });
    const [selected, setSelected] = useState<WorldListItem | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    useEffect(() => {
        const request = { cancelled: false };
        setState({ status: 'loading' });
        fetchUserFavorites(userId)
            .then((result) => {
                if (!request.cancelled) setState(result);
            })
            .catch((e: unknown) => {
                if (request.cancelled) return;
                setState({
                    status: 'error',
                    message: e instanceof Error ? e.message : 'お気に入りを取得できませんでした',
                });
            });
        return () => {
            request.cancelled = true;
        };
    }, [userId]);

    const changeVisibility = async (next: FavoritesVisibility) => {
        setSaving(true);
        setSaveError('');
        try {
            const saved = await setMyFavoritesVisibility(next);
            setState((prev) => (prev.status === 'visible' ? { ...prev, visibility: saved } : prev));
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : '公開範囲を変更できませんでした');
        } finally {
            setSaving(false);
        }
    };

    const worlds = state.status === 'visible' ? state.worlds : [];

    return (
        <section className={css({ mt: '8' })}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '3' })}>
                お気に入りのワールド
                {worlds.length > 0 && (
                    <span className={css({ ml: '2', fontSize: '13px', fontWeight: '500', color: 'textMuted' })}>
                        {worlds.length}
                    </span>
                )}
            </h2>
            {isOwnPage && state.status === 'visible' && (
                <FavoritesVisibilityPicker
                    value={state.visibility}
                    disabled={saving}
                    onChange={(v) => void changeVisibility(v)}
                />
            )}
            {saveError && <p className={css({ mb: '3', fontSize: '13px', color: 'errorText' })}>{saveError}</p>}
            {state.status === 'error' ? (
                <p className={css({ fontSize: '13px', color: 'errorText' })}>{state.message}</p>
            ) : state.status === 'loading' ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
            ) : state.status === 'hidden' ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    このユーザーのお気に入りは公開されていません。
                </p>
            ) : worlds.length === 0 ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    {isOwnPage ? 'お気に入りはまだありません。' : 'お気に入りはありません。'}
                </p>
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
