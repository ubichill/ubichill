import type { AppNotification } from '@ubichill/shared';
import type { ReactNode } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { UserAvatar } from '@/components/social';
import {
    NOTIFICATION_ACTIONS,
    type NotificationActionId,
    type NotificationActionTone,
    notificationDetailOf,
} from '@/lib/notifications/notificationActions';
import { isExpired, notificationText, relativeTime } from '@/lib/notifications/notifications';
import { css, cva } from '@/styled-system/css';
import { useNotificationActions } from './useNotificationActions';

/**
 * 通知 1 件（文面と操作）。押すと既読にする。種類ごとに何を出すかは lib/notifications/notificationActions.ts。
 */
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
    const { actions, run, busy, error } = useNotificationActions(notification, {
        pendingFollow,
        onRead,
        onFriendshipChange,
        onNavigate,
    });
    const { actor } = notification;
    const expired = isExpired(notification, Date.now());
    const detail = notificationDetailOf(notification);

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
                    {detail && <span className={detailText}>{detail}</span>}
                    <span className={css({ display: 'block', fontSize: '12px', color: 'textMuted', mt: '0.5' })}>
                        {relativeTime(notification.published, Date.now())}
                        {expired && '・期限切れ'}
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
            {actions.length > 0 && (
                <div className={css({ display: 'flex', flexShrink: 0, alignItems: 'center', gap: '1' })}>
                    {actions.map((id) => (
                        <ActionButton key={id} id={id} busy={busy} onClick={() => run(id)} />
                    ))}
                </div>
            )}
        </li>
    );
}

const check = <path d="M5 12.5l4.5 4.5L19 7.5" />;
const cross = <path d="M6 6l12 12M18 6L6 18" />;
const bubble = <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />;
const eye = (
    <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
    </>
);
const iconOf = (id: NotificationActionId, tone: NotificationActionTone): ReactNode =>
    tone === 'accept' ? check : tone === 'decline' ? cross : id === 'open-conversation' ? bubble : eye;

/** 見る操作（会話・プロフィール）は API を呼ばないので、ほかの操作の実行中も押せる。 */
function ActionButton({ id, busy, onClick }: { id: NotificationActionId; busy: boolean; onClick: () => void }) {
    const { label, tone } = NOTIFICATION_ACTIONS[id];
    if (tone === 'enter') {
        return (
            <button type="button" className={enterButton} disabled={busy} onClick={onClick}>
                <HudIcon name="enter" size={16} />
                {label}
            </button>
        );
    }
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={tone !== 'view' && busy}
            className={iconButton({ tone })}
            onClick={onClick}
        >
            <svg {...icon} strokeWidth={tone === 'view' ? 2 : 2.4} aria-hidden>
                {iconOf(id, tone)}
            </svg>
        </button>
    );
}

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

const detailText = css({
    display: 'block',
    fontSize: '13px',
    color: 'textMuted',
    mt: '1',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
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

const enterButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    px: '3',
    h: '34px',
    border: 'none',
    borderRadius: '8px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'primaryHover' },
    _disabled: { opacity: 0.5, cursor: 'default', _hover: { bg: 'primary' } },
});

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
