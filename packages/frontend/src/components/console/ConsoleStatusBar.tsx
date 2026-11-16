import { type ConsoleEntry, type ConsoleLevel, formatConsoleCount } from '@/lib/console/console';
import { css } from '@/styled-system/css';
import { ConsoleCounts } from './ConsoleCounts';
import { ConsoleLevelIcon } from './ConsoleLevelIcon';

/** Unity のステータスバー。最後の記録を 1 行だけ出し、押すとコンソールを開く。counts を渡すと右端に件数を出す。 */
export function ConsoleStatusBar({
    entry,
    counts,
    onOpen,
    expanded,
}: {
    entry: ConsoleEntry;
    counts?: Readonly<Record<ConsoleLevel, number>>;
    onOpen: () => void;
    /** すぐ上でコンソールを開いているか（押すと閉じる） */
    expanded?: boolean;
}) {
    return (
        <button type="button" onClick={onOpen} aria-expanded={expanded} className={bar}>
            <ConsoleLevelIcon level={entry.level} />
            <span className={css({ color: 'textSubtle', flexShrink: 0 })}>{entry.source}</span>
            <span className={message}>{entry.message.split('\n')[0]}</span>
            {entry.count > 1 && (
                <span className={css({ color: 'textSubtle', flexShrink: 0 })}>x{formatConsoleCount(entry.count)}</span>
            )}
            {counts && <ConsoleCounts counts={counts} className={css({ flexShrink: 0, ml: '6px' })} />}
        </button>
    );
}

const bar = css({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    w: 'full',
    h: '24px',
    px: '10px',
    flexShrink: 0,
    border: 'none',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'border',
    bg: 'surfaceAccent',
    color: 'text',
    fontSize: '11px',
    textAlign: 'left',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '-2px' },
});

const message = css({ flex: 1, minW: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
