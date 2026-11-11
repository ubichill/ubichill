import { useState } from 'react';
import { css } from '@/styled-system/css';
import { Chevron } from './hierarchy/hierarchyIcons';

interface PanelSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

/**
 * コントロールパネル内で使う、折りたたみ可能なセクション。枠で囲まず、見出しと区切り線だけにする。
 */
export function PanelSection({ title, children, defaultOpen = true }: PanelSectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className={css({
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 0',
                    bg: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid',
                    borderColor: 'border',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: 'text',
                    cursor: 'pointer',
                    textAlign: 'left',
                    _hover: { color: 'primary' },
                })}
            >
                <span className={css({ display: 'inline-flex', color: 'textMuted' })}>
                    <Chevron open={open} />
                </span>
                {title}
            </button>
            {open && (
                <div className={css({ pt: '3', display: 'flex', flexDirection: 'column', gap: '4' })}>{children}</div>
            )}
        </section>
    );
}
