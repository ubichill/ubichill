import { MESSAGE_LIMITS } from '@ubichill/shared';
import { useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { composerKeyAction, draftState } from '@/lib/messages';
import { css, cva } from '@/styled-system/css';

/** 会話の入力欄。Enter で送り、Shift+Enter で改行。上限に近づいたら文字数を出す。送れなければ入力は残す。 */
export function MessageComposer({
    name,
    sending,
    onSend,
}: {
    /** 相手の名前（読み上げの名前に使う） */
    name: string;
    sending: boolean;
    onSend: (content: string) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState('');
    const { length, over, sendable } = draftState(draft);
    const showCount = length > MESSAGE_LIMITS.CONTENT_MAX * 0.8;

    const submit = async () => {
        if (!sendable || sending) return;
        if (await onSend(draft)) setDraft('');
    };

    return (
        <form
            className={form}
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
        >
            <textarea
                value={draft}
                rows={1}
                aria-label={`${name} さんへのメッセージ`}
                className={input({ over })}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (composerKeyAction({ ...e, isComposing: e.nativeEvent.isComposing }) !== 'send') return;
                    e.preventDefault();
                    void submit();
                }}
            />
            {showCount && (
                <span className={count({ over })}>
                    {length} / {MESSAGE_LIMITS.CONTENT_MAX}
                </span>
            )}
            <button type="submit" className={sendButton} disabled={!sendable || sending} aria-label="送る">
                <HudIcon name="send" size={18} />
            </button>
        </form>
    );
}

const form = css({ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: '2' });

const input = cva({
    base: {
        flex: 1,
        minW: 0,
        maxH: '160px',
        px: '3',
        py: '2',
        border: '1px solid',
        borderRadius: '12px',
        bg: 'background',
        color: 'text',
        fontSize: '14px',
        lineHeight: '1.6',
        resize: 'none',
        fieldSizing: 'content',
        _focus: { outline: 'none', borderColor: 'primaryHighlight' },
    },
    variants: {
        over: { true: { borderColor: 'errorText' }, false: { borderColor: 'border' } },
    },
});

const count = cva({
    base: { flexShrink: 0, alignSelf: 'center', fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
    variants: { over: { true: { color: 'errorText' }, false: { color: 'textMuted' } } },
});

const sendButton = css({
    flexShrink: 0,
    w: '40px',
    h: '40px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '12px',
    bg: 'primary',
    color: 'textOnPrimary',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'primaryHover' },
    _disabled: { opacity: 0.4, cursor: 'not-allowed', _hover: { bg: 'primary' } },
});
