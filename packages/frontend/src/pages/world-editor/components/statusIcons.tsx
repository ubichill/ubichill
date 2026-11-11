import { css } from '@/styled-system/css';
import type { ConsoleLevel } from '../lib/editorConsole';
import { WarningIcon } from './hierarchy/hierarchyIcons';

const levelColor = { error: 'error', warning: 'warning', info: 'info' } as const;

/** エラー・警告・情報の印。色だけに頼らず形も変える。 */
export function StatusIcon({ level }: { level: ConsoleLevel }) {
    return (
        <span
            className={css({
                display: 'inline-flex',
                flexShrink: 0,
                color: levelColor[level],
                pt: '1px',
            })}
        >
            {level === 'warning' ? <WarningIcon /> : level === 'error' ? <ErrorIcon /> : <InfoIcon />}
        </span>
    );
}

function ErrorIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 7v6M12 17h.01" />
        </svg>
    );
}

function InfoIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-5M12 8h.01" />
        </svg>
    );
}
