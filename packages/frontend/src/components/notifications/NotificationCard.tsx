import { useState } from 'react';
import { useNavigate } from 'react-router';
import { UserAvatar } from '@/components/social';
import type { AppNotification } from '@/lib/notifications';
import { relativeTime } from '@/lib/notifications';
import { acceptFriend, removeFriend } from '@/lib/socialApi';
import { userPagePath } from '@/lib/userPath';
import { css, cva } from '@/styled-system/css';

const iconButton = cva({
    base: {
        width: '36px',
        height: '36px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid',
        borderColor: 'border',
        borderRadius: '10px',
        bg: 'surface',
        cursor: 'pointer',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            accept: { color: 'successText', _hover: { bg: 'successBg' } },
            decline: { color: 'errorText', _hover: { bg: 'errorBg' } },
            view: { color: 'textMuted', _hover: { bg: 'surfaceHover' } },
        },
    },
});

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4 };

/** 通知 1 件（種類ごとの本文と操作）。 */
export function NotificationCard({
    notification,
    onDone,
    onNavigate,
}: {
    notification: AppNotification;
    /** 操作して通知が片付いた */
    onDone: () => void;
    onNavigate?: () => void;
}) {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { from } = notification;

    const act = async (task: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await task();
            onDone();
        } catch (e) {
            setError(e instanceof Error ? e.message : '操作できませんでした');
            setBusy(false);
        }
    };

    return (
        <li
            className={css({
                display: 'flex',
                gap: '3',
                p: '3',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '14px',
            })}
        >
            <UserAvatar user={from} />
            <div className={css({ flex: 1, minWidth: 0 })}>
                <div className={css({ fontSize: '14px', fontWeight: '700', color: 'text', lineClamp: 1 })}>
                    {from.name}
                </div>
                <p className={css({ fontSize: '13px', color: 'text', mt: '0.5' })}>
                    「{from.name}」{from.handle && `（@${from.handle}）`}からフレンドリクエストが届きました。
                </p>
                <div className={css({ fontSize: '12px', color: 'textMuted', mt: '0.5' })}>
                    {relativeTime(notification.at, Date.now())}
                </div>
                {error && <p className={css({ fontSize: '12px', color: 'errorText', mt: '1' })}>{error}</p>}
                <div className={css({ display: 'flex', justifyContent: 'flex-end', gap: '2', mt: '2' })}>
                    <button
                        type="button"
                        title="承認する"
                        aria-label="承認する"
                        disabled={busy}
                        className={iconButton({ tone: 'accept' })}
                        onClick={() => void act(() => acceptFriend(from.id))}
                    >
                        <svg {...icon} aria-hidden>
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        title="拒否する"
                        aria-label="拒否する"
                        disabled={busy}
                        className={iconButton({ tone: 'decline' })}
                        onClick={() => void act(() => removeFriend(from.id))}
                    >
                        <svg {...icon} aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        title="ユーザーページを見る"
                        aria-label="ユーザーページを見る"
                        className={iconButton({ tone: 'view' })}
                        onClick={() => {
                            onNavigate?.();
                            navigate(userPagePath(from));
                        }}
                    >
                        <svg {...icon} strokeWidth={2} aria-hidden>
                            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    </button>
                </div>
            </div>
        </li>
    );
}
