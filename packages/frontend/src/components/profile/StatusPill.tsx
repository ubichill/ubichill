import { css } from '@/styled-system/css';

const pill = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2',
    maxW: 'full',
    px: '3',
    py: '1.5',
    mb: '2',
    borderRadius: 'full',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    color: 'text',
    fontSize: '13px',
    boxShadow: 'card',
});
const dot = css({ width: '8px', height: '8px', borderRadius: 'full', bg: 'success', flexShrink: 0 });
const text = css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

/** ひとこと（1 行）。長ければ省略し、全文は title で見せる。 */
export function StatusPill({ status }: { status: string }) {
    return (
        <span className={pill} title={status}>
            <span className={dot} aria-hidden />
            <span className={text}>{status}</span>
        </span>
    );
}
