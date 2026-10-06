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
    /** 自分のユーザー名を押したとき（マイページを開く） */
    onUserClick: () => void;
}

/** 右上の自分のユーザー名（押すとマイページ）と、▼ のメニュー（ログアウトなど。項目が無ければ出さない）。 */
export function LobbyAccountMenu({ userName, items, onUserClick }: LobbyAccountMenuProps) {
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
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    width: 'full',
                    minWidth: 0,
                    bg: 'glassBg',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid',
                    borderColor: open ? 'borderStrong' : 'border',
                    borderRadius: 'full',
                    boxShadow: 'card',
                    color: 'textMuted',
                    overflow: 'hidden',
                })}
            >
                <button
                    type="button"
                    onClick={onUserClick}
                    title="マイページ"
                    className={css({
                        minWidth: 0,
                        pl: '12px',
                        pr: items.length > 0 ? '6px' : '12px',
                        py: '7px',
                        bg: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: 'sm',
                        fontWeight: '600',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        _hover: { color: 'text' },
                    })}
                >
                    {userName}
                </button>
                {items.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setOpen((value) => !value)}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label="アカウントのメニュー"
                        className={css({
                            display: 'flex',
                            alignItems: 'center',
                            pl: '4px',
                            pr: '10px',
                            py: '7px',
                            bg: 'transparent',
                            border: 'none',
                            color: 'inherit',
                            cursor: 'pointer',
                            _hover: { color: 'text' },
                        })}
                    >
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
                )}
            </div>

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
