import { useState } from 'react';
import { isPendingFollow, NotificationCard, useNotifications } from '@/components/notifications';
import { NOTIFICATION_TABS, type NotificationKind } from '@/lib/notifications';
import { css, cva } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

const EMPTY: Record<NotificationKind, string> = {
    invite: '招待はありません。',
    'friend-request': 'フレンドの通知はありません。',
    other: 'その他の通知はありません。',
};

const tab = cva({
    base: {
        flex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5',
        py: '2',
        bg: 'transparent',
        borderWidth: '0 0 3px 0',
        borderStyle: 'solid',
        fontSize: '13px',
        fontWeight: '700',
        cursor: 'pointer',
    },
    variants: {
        active: {
            true: { borderColor: 'primary', color: 'text' },
            false: { borderColor: 'transparent', color: 'textMuted' },
        },
    },
});

const textButton = cva({
    base: {
        px: '3',
        py: '1.5',
        borderRadius: '8px',
        border: '1px solid',
        borderColor: 'border',
        bg: 'surface',
        color: 'text',
        fontSize: '12px',
        fontWeight: '700',
        cursor: 'pointer',
        _hover: { bg: 'surfaceHover' },
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
});

/** 通知タブ。種類（招待・フレンド・その他）ごとのタブに分ける。未読は強調し、押すと既読にする。 */
export function NotificationsTab({ onNavigate }: { onNavigate?: () => void }) {
    const { feed, groups, error, incomingIds, markRead, loadMore, reload } = useNotifications();
    const firstWithUnread = NOTIFICATION_TABS.find((t) => groups[t.kind].some((n) => !n.read))?.kind;
    const [kind, setKind] = useState<NotificationKind>(firstWithUnread ?? 'friend-request');
    const items = groups[kind];

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <div className={css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' })}>
                    <h2 className={sectionHeading}>通知</h2>
                    <button
                        type="button"
                        className={textButton()}
                        disabled={feed.unreadCount === 0}
                        onClick={() => void markRead({ all: true })}
                    >
                        すべて既読にする
                    </button>
                </div>
                <div
                    role="tablist"
                    className={css({ display: 'flex', borderBottom: '1px solid', borderColor: 'border', mb: '3' })}
                >
                    {NOTIFICATION_TABS.map((t) => {
                        const unread = groups[t.kind].filter((n) => !n.read).length;
                        return (
                            <button
                                key={t.kind}
                                type="button"
                                role="tab"
                                aria-selected={t.kind === kind}
                                onClick={() => setKind(t.kind)}
                                className={tab({ active: t.kind === kind })}
                            >
                                {t.label}
                                {unread > 0 && `（${unread}）`}
                                {unread > 0 && (
                                    <span
                                        className={css({
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: 'full',
                                            bg: 'errorText',
                                        })}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
                {error && <p className={css({ fontSize: '12px', color: 'errorText', mb: '2' })}>{error}</p>}
                {items.length === 0 ? (
                    <p className={css({ fontSize: '13px', color: 'textMuted', py: '4', textAlign: 'center' })}>
                        {feed.loaded ? EMPTY[kind] : '読み込み中…'}
                    </p>
                ) : (
                    <ul className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        {items.map((n) => (
                            <NotificationCard
                                key={n.id}
                                notification={n}
                                pendingFollow={isPendingFollow(n, incomingIds)}
                                onRead={() => {
                                    if (!n.read) void markRead({ ids: [n.id] });
                                }}
                                onFriendshipChange={() => void reload()}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </ul>
                )}
                {feed.nextCursor && (
                    <div className={css({ display: 'flex', justifyContent: 'center', mt: '3' })}>
                        <button type="button" className={textButton()} onClick={() => void loadMore()}>
                            もっと見る
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
