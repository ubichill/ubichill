import type { MouseEvent } from 'react';
import { css, cx } from '@/styled-system/css';
import { useFavorites } from './useFavorites';

interface FavoriteButtonProps {
    /** お気に入りのキー＝ワールドの正規 URL。 */
    worldRef: string;
    /**
     * icon: 星アイコンのみ（カード隅などの省スペース用）
     * labeled: アイコン＋文言（詳細画面の副次アクション用）
     */
    variant?: 'icon' | 'labeled';
    className?: string;
}

const starPath =
    'M11.48 3.5a.56.56 0 0 1 1.04 0l2.36 5.14 5.6.62c.5.05.7.68.32 1.02l-4.17 3.8 1.15 5.5a.56.56 0 0 1-.83.6L12 17.9l-4.94 2.88a.56.56 0 0 1-.83-.6l1.15-5.5-4.17-3.8a.56.56 0 0 1 .32-1.02l5.6-.62 2.35-5.14Z';

/**
 * ワールドのお気に入りトグル。共有ストア（useFavorites）に接続するので
 * どこで押しても全カード/画面の表示が同期する。カード内で使う場合は親の
 * クリックへ伝播しないよう stopPropagation する。
 */
export function FavoriteButton({ worldRef, variant = 'icon', className }: FavoriteButtonProps) {
    const { isFavorite, toggle } = useFavorites();
    const on = isFavorite(worldRef);
    const label = on ? 'お気に入り済み' : 'お気に入りに追加';

    const handle = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        void toggle(worldRef);
    };

    if (variant === 'labeled') {
        return (
            <button
                type="button"
                onClick={handle}
                aria-pressed={on}
                className={cx(
                    css({
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2',
                        py: '2.5',
                        bg: 'secondary',
                        color: on ? 'warning' : 'text',
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '10px',
                        fontSize: 'sm',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _hover: { opacity: 0.9 },
                    }),
                    className,
                )}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill={on ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                >
                    <path d={starPath} />
                </svg>
                {label}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={handle}
            aria-pressed={on}
            aria-label={label}
            title={label}
            className={cx(
                css({
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    bg: 'rgba(0,0,0,0.45)',
                    color: on ? 'warning' : 'white',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.12s ease, background-color 0.16s ease',
                    _hover: { bg: 'rgba(0,0,0,0.6)', transform: 'scale(1.08)' },
                }),
                className,
            )}
        >
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill={on ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
            >
                <path d={starPath} />
            </svg>
        </button>
    );
}
