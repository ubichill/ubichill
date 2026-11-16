import { type ConsoleLevel, formatConsoleCount } from '@/lib/console/console';
import { css, cx } from '@/styled-system/css';
import { ConsoleLevelIcon } from './ConsoleLevelIcon';

const item = css({ display: 'inline-flex', alignItems: 'center', gap: '3px', fontVariantNumeric: 'tabular-nums' });

/** 種類ごとの件数（0 件の種類は出さない）。エラー・警告が出ていると一目で分かるように。 */
export function ConsoleCounts({
    counts,
    levels = ['error', 'warning'],
    className,
}: {
    counts: Readonly<Record<ConsoleLevel, number>>;
    levels?: readonly ConsoleLevel[];
    className?: string;
}) {
    const shown = levels.filter((level) => counts[level] > 0);
    if (shown.length === 0) return null;
    return (
        <span className={cx(css({ display: 'inline-flex', alignItems: 'center', gap: '8px' }), className)}>
            {shown.map((level) => (
                <span key={level} className={item}>
                    <ConsoleLevelIcon level={level} />
                    {formatConsoleCount(counts[level])}
                </span>
            ))}
        </span>
    );
}
