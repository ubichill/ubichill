import type { AppNotification } from '@ubichill/shared';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { HudIcon } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { UserAvatar, useOpenUser } from '@/components/social';
import { answerFollower } from '@/lib/fediverseApi';
import { acceptInviteRequest, declineInviteRequest } from '@/lib/inviteApi';
import { isExpired, notificationText, relativeTime } from '@/lib/notifications';
import { acceptFriend, removeFriend } from '@/lib/socialApi';
import { css, cva } from '@/styled-system/css';

/**
 * 通知 1 件（種類ごとの文面と操作）。押すと既読にする。
 * - フレンド申請（返事をしていないもの）: 承認・拒否
 * - 招待: 入る（期限内・今いる部屋でないとき）
 * - リクエストインバイト: 招待する（いま自分がいる部屋へ）・断る
 * - フェディバースのフォローリクエスト: 承認・拒否（片付いたら通知ごと消える）
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
    const openUser = useOpenUser(onNavigate);
    const hud = useHudNavigation();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { actor } = notification;
    const actorHandle = actor.preferredUsername;
    const expired = isExpired(notification, Date.now());

    const act = async (task: () => Promise<unknown>, after?: () => void) => {
        setBusy(true);
        setError(null);
        try {
            await task();
            after?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : '操作できませんでした');
        } finally {
            setBusy(false);
        }
    };

    const enter = (instance: { id: string; name: string; image: string | null }) => {
        onRead();
        const worldData = { displayName: instance.name, thumbnail: instance.image ?? undefined };
        if (hud) {
            hud.joinInstance(instance.id, '', worldData);
            return;
        }
        onNavigate?.();
        navigate(`/instance/${encodeURIComponent(instance.id)}`, { state: { worldData } });
    };

    const actions: ReactNode[] = [];
    if (pendingFollow) {
        actions.push(
            <IconAction
                key="accept"
                label="承認する"
                tone="accept"
                disabled={busy}
                onClick={() => void act(() => acceptFriend(actor.id), onFriendshipChange)}
            >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
            </IconAction>,
            <IconAction
                key="decline"
                label="拒否する"
                tone="decline"
                disabled={busy}
                onClick={() => void act(() => removeFriend(actor.id), onFriendshipChange)}
            >
                <path d="M6 6l12 12M18 6L6 18" />
            </IconAction>,
        );
    }
    if (notification.type === 'FediverseFollowRequest') {
        actions.push(
            <IconAction
                key="approve-follow"
                label="承認する"
                tone="accept"
                disabled={busy}
                onClick={() => void act(() => answerFollower(actor.id, 'approve'))}
            >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
            </IconAction>,
            <IconAction
                key="reject-follow"
                label="拒否する"
                tone="decline"
                disabled={busy}
                onClick={() => void act(() => answerFollower(actor.id, 'reject'))}
            >
                <path d="M6 6l12 12M18 6L6 18" />
            </IconAction>,
        );
    }
    if (notification.type === 'Invite' && !expired && notification.object.id !== hud?.currentInstanceId) {
        const instance = notification.object;
        actions.push(
            <button key="enter" type="button" className={enterButton} onClick={() => enter(instance)}>
                <HudIcon name="enter" size={16} />
                入る
            </button>,
        );
    }
    if (notification.type === 'Join' && !expired) {
        actions.push(
            <IconAction
                key="invite"
                label="招待する"
                tone="accept"
                disabled={busy}
                onClick={() => void act(() => acceptInviteRequest(actor.id), onRead)}
            >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
            </IconAction>,
            <IconAction
                key="refuse"
                label="断る"
                tone="decline"
                disabled={busy}
                onClick={() => void act(() => declineInviteRequest(actor.id))}
            >
                <path d="M6 6l12 12M18 6L6 18" />
            </IconAction>,
        );
    }
    if (actorHandle && notification.type !== 'Announce') {
        actions.push(
            <IconAction
                key="view"
                label="プロフィールを見る"
                tone="view"
                onClick={() => {
                    onRead();
                    openUser({ id: actor.id, handle: actorHandle });
                }}
            >
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
            </IconAction>,
        );
    }

    const detail =
        notification.type === 'Announce'
            ? notification.object.content
            : notification.type === 'Invite'
              ? notification.content
              : null;

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
                <div className={css({ display: 'flex', flexShrink: 0, alignItems: 'center', gap: '1' })}>{actions}</div>
            )}
        </li>
    );
}

function IconAction({
    label,
    tone,
    disabled,
    onClick,
    children,
}: {
    label: string;
    tone: 'accept' | 'decline' | 'view';
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            className={iconButton({ tone })}
            onClick={onClick}
        >
            <svg {...icon} strokeWidth={tone === 'view' ? 2 : 2.4} aria-hidden>
                {children}
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
});

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
