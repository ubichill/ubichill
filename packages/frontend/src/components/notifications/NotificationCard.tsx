import type { AppNotification } from '@ubichill/shared';
import { useState } from 'react';
import { UserAvatar, useOpenUser } from '@/components/social';
import { notificationText, relativeTime } from '@/lib/notifications';
import { acceptFriend, removeFriend } from '@/lib/socialApi';
import { css, cva } from '@/styled-system/css';

const card = cva({
    base: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '3',
        px: '3',
        py: '2.5',
        borderRadius: '10px',
        textAlign: 'left',
        width: 'full',
    },
    variants: {
        read: {
            true: { bg: 'transparent' },
            false: { bg: 'surface' },
        },
    },
});

const unreadDot = css({
    display: 'inline-block',
    w: '7px',
    h: '7px',
    ml: '2',
    borderRadius: 'full',
    bg: 'primaryHighlight',
    verticalAlign: 'middle',
});

const iconButton = cva({
    base: {
        width: '36px',
        height: '36px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: '8px',
        bg: 'transparent',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
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

/** 通知 1 件（種類ごとの文面。返事をしていない申請には承認・拒否）。押すと既読にする。 */
export function NotificationCard({
    notification,
    pendingFollow,
    onRead,
    onFriendshipChange,
    onNavigate,
}: {
    notification: AppNotification;
    /** まだ返事をしていない申請（承認・拒否を出す） */
    pendingFollow: boolean;
    onRead: () => void;
    onFriendshipChange: () => void;
    onNavigate?: () => void;
}) {
    const openUser = useOpenUser(onNavigate);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { actor } = notification;
    const actorHandle = actor.preferredUsername;

    const act = async (task: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await task();
            onFriendshipChange();
        } catch (e) {
            setError(e instanceof Error ? e.message : '操作できませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className={card({ read: notification.read })}>
            <UserAvatar user={{ name: actor.name, image: actor.icon }} />
            <div className={css({ flex: 1, minWidth: 0 })}>
                <button
                    type="button"
                    onClick={onRead}
                    disabled={notification.read}
                    className={css({
                        display: 'block',
                        width: 'full',
                        textAlign: 'left',
                        bg: 'transparent',
                        border: 'none',
                        p: '0',
                        cursor: notification.read ? 'default' : 'pointer',
                        color: 'text',
                    })}
                >
                    <span className={css({ display: 'block', fontSize: '13px' })}>
                        {notificationText(notification)}
                    </span>
                    {notification.type === 'Announce' && (
                        <span
                            className={css({
                                display: 'block',
                                fontSize: '13px',
                                color: 'textMuted',
                                mt: '1',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            })}
                        >
                            {notification.object.content}
                        </span>
                    )}
                    <span className={css({ display: 'block', fontSize: '12px', color: 'textMuted', mt: '0.5' })}>
                        {relativeTime(notification.published, Date.now())}
                        {!notification.read && (
                            <>
                                <span className={unreadDot} aria-hidden="true" />
                                <span className={css({ srOnly: true })}>未読</span>
                            </>
                        )}
                    </span>
                </button>
                {error && <p className={css({ fontSize: '12px', color: 'errorText', mt: '1' })}>{error}</p>}
            </div>
            {(pendingFollow || (actorHandle && notification.type !== 'Announce')) && (
                <div className={css({ display: 'flex', flexShrink: 0, gap: '1' })}>
                    {pendingFollow && (
                        <>
                            <button
                                type="button"
                                title="承認する"
                                aria-label="承認する"
                                disabled={busy}
                                className={iconButton({ tone: 'accept' })}
                                onClick={() => void act(() => acceptFriend(actor.id))}
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
                                onClick={() => void act(() => removeFriend(actor.id))}
                            >
                                <svg {...icon} aria-hidden>
                                    <path d="M6 6l12 12M18 6L6 18" />
                                </svg>
                            </button>
                        </>
                    )}
                    {actorHandle && notification.type !== 'Announce' && (
                        <button
                            type="button"
                            title="プロフィールを見る"
                            aria-label="プロフィールを見る"
                            className={iconButton({ tone: 'view' })}
                            onClick={() => {
                                onRead();
                                openUser({ id: actor.id, handle: actorHandle });
                            }}
                        >
                            <svg {...icon} strokeWidth={2} aria-hidden>
                                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </button>
                    )}
                </div>
            )}
        </li>
    );
}
