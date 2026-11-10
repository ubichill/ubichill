import { type MessageReaction, tallyReactions } from '@ubichill/shared';
import { css, cva } from '@/styled-system/css';

/** 1 通のリアクション（絵文字ごとの数）。押すと自分のものを付け外しする。送れない相手との会話では見るだけ。 */
export function MessageReactions({
    reactions,
    selfId,
    mine,
    disabled,
    onToggle,
}: {
    reactions: readonly MessageReaction[];
    selfId: string | undefined;
    /** 自分のメッセージか（並べる向き） */
    mine: boolean;
    disabled: boolean;
    onToggle: (emoji: string) => void;
}) {
    const tallies = tallyReactions(reactions, selfId);
    if (tallies.length === 0) return null;
    return (
        <ul className={row({ mine })}>
            {tallies.map((t) => (
                <li key={t.emoji}>
                    <button
                        type="button"
                        className={chip({ mine: t.mine })}
                        aria-pressed={t.mine}
                        aria-label={`${t.emoji} ${t.count}`}
                        disabled={disabled}
                        onClick={() => onToggle(t.emoji)}
                    >
                        <span className={css({ fontSize: '15px', lineHeight: 1 })}>{t.emoji}</span>
                        <span className={count}>{t.count}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

const row = cva({
    base: { display: 'flex', flexWrap: 'wrap', gap: '1' },
    variants: { mine: { true: { justifyContent: 'flex-end' }, false: { justifyContent: 'flex-start' } } },
});

const chip = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1',
        h: '26px',
        px: '2',
        border: '1px solid',
        borderRadius: '999px',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _disabled: { cursor: 'default' },
    },
    variants: {
        mine: {
            true: { bg: 'primarySubtle', borderColor: 'primaryHighlight', color: 'text' },
            false: { bg: 'surface', borderColor: 'border', color: 'textMuted', _hover: { bg: 'surfaceHover' } },
        },
    },
});

const count = css({ fontSize: '12px', fontWeight: '700', fontVariantNumeric: 'tabular-nums' });
