import { MESSAGE_REFUSAL_MESSAGES, toggledReaction } from '@ubichill/shared';
import { useCallback, useRef, useState } from 'react';
import { EmojiPicker } from '@/components/emoji';
import { HudIcon } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { UserAvatar } from '@/components/social/UserAvatar';
import { messageTime } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { css, cva, cx } from '@/styled-system/css';
import { MessageComposer } from './MessageComposer';
import { MessageReactions } from './MessageReactions';
import { useConversation } from './useConversation';

/**
 * 1 人との会話（ランチパッドに重ねる画面）。上の名前を押すと相手のプロフィール。送れなくなった相手でも過去の分は読める。
 * 各メッセージにリアクションできる（送れない相手との会話では見るだけ）。
 */
export function ConversationView({ userId }: { userId: string }) {
    const hud = useHudNavigation();
    const { data: session } = useSession();
    const selfId = session?.user.id;
    const { state, error, sending, loadOlder, send, react } = useConversation(userId, selfId);
    // リアクションを選んでいる 1 通（選ぶ画面は会話に 1 つだけ。流れる一覧の中に置くと端で切れる）
    const [reactingTo, setReactingTo] = useState<string | null>(null);
    const reactButton = useRef<HTMLElement | null>(null);
    const closePicker = useCallback(() => setReactingTo(null), []);
    const now = new Date();
    const canReact = !!state && !state.refusal && !!selfId;

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
                        const picking = reactingTo === m.id;
                        return (
                            <li key={m.id} className={cx('group', item({ mine }))}>
                                <div className={bubbleRow({ mine })}>
                                    <p className={bubble({ mine })}>{m.content}</p>
                                    {canReact && (
                                        <button
                                            type="button"
                                            className={reactToggle}
                                            aria-label="リアクション"
                                            aria-expanded={picking}
                                            onClick={(e) => {
                                                reactButton.current = e.currentTarget;
                                                setReactingTo(picking ? null : m.id);
                                            }}
                                        >
                                            <HudIcon name="smilePlus" size={16} />
                                        </button>
                                    )}
                                </div>
                                <MessageReactions
                                    reactions={m.reactions}
                                    selfId={selfId}
                                    mine={mine}
                                    disabled={!canReact}
                                    onToggle={(emoji) =>
                                        selfId && void react(m.id, toggledReaction(m.reactions, selfId, emoji))
                                    }
                                />
                                <time dateTime={m.published} className={time}>
                                    {messageTime(m.published, now)}
                                </time>
                            </li>
                        );
                    })}
                </ol>
                {!state && !error && <p className={muted}>読み込み中...</p>}
            </div>

            {reactingTo && canReact && (
                <EmojiPicker
                    anchor={reactButton}
                    className={pickerPlace}
                    onSelect={(emoji) => void react(reactingTo, emoji)}
                    onClose={closePicker}
                />
            )}
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
    position: 'relative',
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

const bubbleRow = cva({
    base: { display: 'flex', alignItems: 'center', gap: '1', maxW: 'full' },
    variants: { mine: { true: { flexDirection: 'row-reverse' }, false: { flexDirection: 'row' } } },
});

// 押せる場所は見えなくても残す（タッチの端末はホバーが無いので、そこでは常に出す）
const reactToggle = css({
    flexShrink: 0,
    w: '28px',
    h: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '999px',
    bg: 'transparent',
    color: 'textMuted',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.16s ease',
    _groupHover: { opacity: 1 },
    _focusVisible: { opacity: 1 },
    _expanded: { opacity: 1, bg: 'surfaceAccent', color: 'text' },
    _hover: { bg: 'surfaceHover', color: 'text' },
    '@media (hover: none)': { opacity: 1 },
});

const pickerPlace = css({ position: 'absolute', bottom: '56px', right: 0 });

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
