import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { UserAvatar } from '@/components/social/UserAvatar';
import { messagePreview, messageTime } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { css, cva } from '@/styled-system/css';
import { useConversations } from './useConversations';

/** 会話の一覧（新しい順）。押すと会話を開く。未読のある会話は強調する。 */
export function ConversationList() {
    const hud = useHudNavigation();
    const { data: session } = useSession();
    const { conversations, error } = useConversations();
    const now = new Date();

    if (error) return <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>;
    if (!conversations) return <p className={muted}>読み込み中...</p>;
    if (conversations.length === 0) return <p className={muted}>まだメッセージはありません</p>;

    return (
        <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
            {conversations.map(({ user, last, unreadCount }) => {
                const mine = last.senderId === session?.user.id;
                const unread = unreadCount > 0;
                return (
                    <li key={user.id}>
                        <button
                            type="button"
                            className={row({ unread })}
                            onClick={() => hud?.openConversation(user.id)}
                        >
                            <UserAvatar user={user} />
                            <span className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column' })}>
                                <span className={css({ display: 'flex', alignItems: 'baseline', gap: '2' })}>
                                    <span className={name}>{user.name}</span>
                                    <time dateTime={last.published} className={time}>
                                        {messageTime(last.published, now)}
                                    </time>
                                </span>
                                <span className={preview({ unread })}>
                                    {mine && <span className={css({ color: 'textMuted' })}>あなた: </span>}
                                    {messagePreview(last.content)}
                                </span>
                            </span>
                            {unread && (
                                <span className={badge}>
                                    <span className={css({ srOnly: true })}>未読 </span>
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            )}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

const muted = css({ fontSize: '13px', color: 'textMuted' });

const row = cva({
    base: {
        w: 'full',
        display: 'flex',
        alignItems: 'center',
        gap: '3',
        px: '3',
        py: '2.5',
        border: 'none',
        borderRadius: '10px',
        textAlign: 'left',
        color: 'text',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _hover: { bg: 'surfaceHover' },
    },
    variants: {
        unread: { true: { bg: 'surface' }, false: { bg: 'transparent' } },
    },
});

const name = css({
    flex: 1,
    minW: 0,
    fontSize: '14px',
    fontWeight: '700',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const time = css({ flexShrink: 0, fontSize: '11px', color: 'textMuted', fontVariantNumeric: 'tabular-nums' });

const preview = cva({
    base: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    variants: {
        unread: { true: { color: 'text', fontWeight: '600' }, false: { color: 'textMuted' } },
    },
});

const badge = css({
    flexShrink: 0,
    minW: '20px',
    h: '20px',
    px: '1.5',
    borderRadius: 'full',
    bg: 'errorText',
    color: 'white',
    fontSize: '11px',
    fontWeight: '700',
    lineHeight: '20px',
    textAlign: 'center',
});
