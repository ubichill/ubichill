import { useState } from 'react';
import { NotificationCard, type NotificationsState } from '@/components/notifications';
import { NOTIFICATION_TABS, type NotificationKind } from '@/lib/notifications';
import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

const EMPTY: Record<NotificationKind, string> = {
    invite: '招待はありません。',
    'friend-request': 'フレンドリクエストはありません。',
    other: 'その他の通知はありません。',
};

/** 通知タブ。種類（招待・フレンドリクエスト・その他）ごとのタブに分ける。 */
export function NotificationsTab({
    notifications,
    onNavigate,
}: {
    notifications: NotificationsState;
    onNavigate?: () => void;
}) {
    const firstWithItems = NOTIFICATION_TABS.find((t) => notifications.groups[t.kind].length > 0)?.kind;
    const [kind, setKind] = useState<NotificationKind>(firstWithItems ?? 'invite');
    const items = notifications.groups[kind];

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>通知</h2>
                <div
                    role="tablist"
                    className={css({ display: 'flex', borderBottom: '1px solid', borderColor: 'border', mb: '3' })}
                >
                    {NOTIFICATION_TABS.map((t) => {
                        const count = notifications.groups[t.kind].length;
                        const active = t.kind === kind;
                        return (
                            <button
                                key={t.kind}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setKind(t.kind)}
                                className={css({
                                    flex: 1,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '1.5',
                                    py: '2',
                                    bg: 'transparent',
                                    border: 'none',
                                    borderBottom: '3px solid',
                                    borderColor: active ? 'primary' : 'transparent',
                                    color: active ? 'text' : 'textMuted',
                                    fontSize: '13px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                })}
                            >
                                {t.label}（{count}）
                                {count > 0 && (
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
                {items.length === 0 ? (
                    <p className={css({ fontSize: '13px', color: 'textMuted', py: '4', textAlign: 'center' })}>
                        {EMPTY[kind]}
                    </p>
                ) : (
                    <ul className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        {items.map((n) => (
                            <NotificationCard
                                key={n.id}
                                notification={n}
                                onDone={() => void notifications.reload()}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
