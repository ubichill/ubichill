import { MESSAGE_REFUSAL_MESSAGES } from '@ubichill/shared';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { UserAvatar } from '@/components/social/UserAvatar';
import { messageTime } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { css, cva } from '@/styled-system/css';
import { MessageComposer } from './MessageComposer';
import { useConversation } from './useConversation';

/** 1 人との会話（ランチパッドに重ねる画面）。上の名前を押すと相手のプロフィール。送れなくなった相手でも過去の分は読める。 */
export function ConversationView({ userId }: { userId: string }) {
    const hud = useHudNavigation();
    const { data: session } = useSession();
    const { state, error, sending, loadOlder, send } = useConversation(userId);
    const now = new Date();
    const selfId = session?.user.id;

    return (
        <div className={layout} onClick={(e) => e.stopPropagation()}>
            {state && (
                <button type="button" className={peer} onClick={() => hud?.openUser(userId)}>
                    <UserAvatar user={state.user} size="sm" />
                    <span className={css({ minW: 0, display: 'flex', flexDirection: 'column' })}>
                        <span className={peerName}>{state.user.name}</span>
                        <span className={css({ fontSize: '12px', color: 'textMuted' })}>@{state.user.handle}</span>
                    </span>
                </button>
            )}

            {/* 新しいものを下に出し、開いたときも届いたときも下に寄せる（column-reverse で末尾に吸い付く） */}
            <div className={scroller}>
                <ol className={css({ display: 'flex', flexDirection: 'column', gap: '1.5' })}>
                    {state?.nextCursor && (
                        <li className={css({ display: 'flex', justifyContent: 'center', pb: '2' })}>
                            <button type="button" className={olderButton} onClick={() => void loadOlder()}>
                                前のメッセージ
                            </button>
                        </li>
                    )}
                    {state?.messages.map((m) => {
                        const mine = m.senderId === selfId;
                        return (
                            <li key={m.id} className={item({ mine })}>
                                <p className={bubble({ mine })}>{m.content}</p>
                                <time dateTime={m.published} className={time}>
                                    {messageTime(m.published, now)}
                                </time>
                            </li>
                        );
                    })}
                </ol>
                {!state && !error && <p className={muted}>読み込み中...</p>}
            </div>

            {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
            {state &&
                (state.refusal ? (
                    <p className={refusal}>{MESSAGE_REFUSAL_MESSAGES[state.refusal]}</p>
                ) : (
                    <MessageComposer name={state.user.name} sending={sending} onSend={send} />
                ))}
        </div>
    );
}

const layout = css({
    h: 'full',
    minH: 0,
    w: 'full',
    maxW: '730px',
    mx: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
});

const peer = css({
    alignSelf: 'flex-start',
    maxW: 'full',
    display: 'flex',
    alignItems: 'center',
    gap: '2.5',
    px: '2',
    py: '1.5',
    ml: '-2',
    bg: 'transparent',
    border: 'none',
    borderRadius: '10px',
    textAlign: 'left',
    color: 'text',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
});

const peerName = css({
    fontSize: '15px',
    fontWeight: '800',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const scroller = css({
    flex: 1,
    minH: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column-reverse',
    py: '2',
});

const item = cva({
    base: { display: 'flex', flexDirection: 'column', maxW: '80%', gap: '0.5' },
    variants: {
        mine: { true: { alignSelf: 'flex-end', alignItems: 'flex-end' }, false: { alignSelf: 'flex-start' } },
    },
});

const bubble = cva({
    base: {
        px: '3',
        py: '2',
        borderRadius: '14px',
        fontSize: '14px',
        lineHeight: '1.6',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
    },
    variants: {
        mine: {
            true: { bg: 'primary', color: 'textOnPrimary', borderBottomRightRadius: '4px' },
            false: { bg: 'surface', color: 'text', borderBottomLeftRadius: '4px' },
        },
    },
});

const time = css({ fontSize: '11px', color: 'textMuted', px: '1', fontVariantNumeric: 'tabular-nums' });

const muted = css({ fontSize: '13px', color: 'textMuted', textAlign: 'center' });

const olderButton = css({
    px: '3',
    py: '1.5',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'textMuted',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover', color: 'text' },
});

const refusal = css({
    px: '3',
    py: '2.5',
    borderRadius: '10px',
    bg: 'surface',
    color: 'textMuted',
    fontSize: '13px',
    textAlign: 'center',
});
