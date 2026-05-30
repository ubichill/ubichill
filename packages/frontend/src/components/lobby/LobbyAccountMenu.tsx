import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { css } from '@/styled-system/css';

export interface AccountMenuItem {
    id: string;
    label: string;
    onSelect: () => void | Promise<void>;
    icon?: ReactNode;
    variant?: 'default' | 'danger';
}

interface LobbyAccountMenuProps {
    userName: string;
    items: AccountMenuItem[];
}

export function LobbyAccountMenu({ userName, items }: LobbyAccountMenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const handleSelect = (item: AccountMenuItem) => {
        setOpen(false);
        void item.onSelect();
    };

    return (
        <div
            ref={rootRef}
            className={css({
                position: 'fixed',
                top: '12px',
                right: '12px',
                zIndex: 10,
                maxWidth: 'calc(100vw - 170px)',
            })}
        >
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: 'full',
                    minWidth: 0,
                    px: '12px',
                    py: '7px',
                    bg: 'glassBg',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid',
                    borderColor: open ? 'borderStrong' : 'border',
                    borderRadius: 'full',
                    boxShadow: 'card',
                    color: 'textMuted',
                    cursor: 'pointer',
                    _hover: { borderColor: 'borderStrong', color: 'text' },
                })}
            >
                <span
                    className={css({
                        fontSize: 'sm',
                        fontWeight: '600',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    })}
                >
                    {userName}
                </span>
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={css({
                        flexShrink: 0,
                        transition: 'transform 0.14s ease',
                        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                    })}
                    aria-hidden="true"
                >
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>

            {open && (
                <div
                    role="menu"
                    className={css({
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        width: '220px',
                        maxWidth: 'calc(100vw - 24px)',
                        padding: '6px',
                        bg: 'surface',
                        border: '1px solid',
                        borderColor: 'borderStrong',
                        borderRadius: '12px',
                        boxShadow: 'card',
                    })}
                >
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            onClick={() => handleSelect(item)}
                            className={css({
                                width: 'full',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '9px 10px',
                                bg: 'transparent',
                                border: 'none',
                                borderRadius: '8px',
                                color: item.variant === 'danger' ? 'errorText' : 'text',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                textAlign: 'left',
                                _hover: {
                                    bg: item.variant === 'danger' ? 'errorBg' : 'surfaceAccent',
                                },
                            })}
                        >
                            {item.icon && (
                                <span className={css({ display: 'flex', flexShrink: 0, color: 'inherit' })}>
                                    {item.icon}
                                </span>
                            )}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
