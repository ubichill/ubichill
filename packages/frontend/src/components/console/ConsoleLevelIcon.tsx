import type { ConsoleLevel } from '@/lib/console/console';
import { css, cx } from '@/styled-system/css';

const icon = css({ display: 'inline-flex', flexShrink: 0 });
const levelColor = {
    error: css({ color: 'error' }),
    warning: css({ color: 'warning' }),
    info: css({ color: 'info' }),
} as const;

/** エラー・警告・情報の印。色だけに頼らず形も変える。 */
export function ConsoleLevelIcon({ level, className }: { level: ConsoleLevel; className?: string }) {
    return (
        <span className={cx(icon, levelColor[level], className)}>
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                {level === 'warning' ? (
                    <>
                        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                        <path d="M12 9v4M12 17h.01" />
                    </>
                ) : (
                    <>
                        <circle cx="12" cy="12" r="10" />
                        <path d={level === 'error' ? 'M12 7v6M12 17h.01' : 'M12 16v-5M12 8h.01'} />
                    </>
                )}
            </svg>
        </span>
    );
}
