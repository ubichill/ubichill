import { useState } from 'react';
import { css } from '@/styled-system/css';

interface PanelSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

/**
 * コントロールパネル内で使う、折りたたみ可能なセクション（ヘッダーバー + ▼トグル）。
 * VRChat SDK Builder パネル風の見た目に寄せるための共通部品。
 */
export function PanelSection({ title, children, defaultOpen = true }: PanelSectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div
            className={css({
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '10px',
                overflow: 'hidden',
            })}
        >
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className={css({
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    bg: 'surfaceAccent',
                    border: 'none',
                    borderBottom: open ? '1px solid' : 'none',
                    borderColor: 'border',
                    fontSize: '13px',
                    fontWeight: '700',
                    color: 'text',
                    cursor: 'pointer',
                    textAlign: 'left',
                    _hover: { bg: 'surfaceHover' },
                })}
            >
                <span
                    className={css({
                        display: 'inline-block',
                        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform 0.12s ease',
                        fontSize: '10px',
                        color: 'textMuted',
                    })}
                >
                    ▼
                </span>
                {title}
            </button>
            {open && (
                <div className={css({ padding: '12px', display: 'flex', flexDirection: 'column', gap: '4' })}>
                    {children}
                </div>
            )}
        </div>
    );
}
