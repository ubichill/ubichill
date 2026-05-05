import { useEffect } from 'react';
import { css } from '@/styled-system/css';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    /** モーダル幅 (CSS) */
    width?: string;
}

/**
 * 共通モーダル。背景クリック・ESCキーで閉じる。
 */
export function Modal({ open, onClose, title, children, width = '640px' }: ModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            onClick={onClose}
            className={css({
                position: 'fixed',
                inset: 0,
                bg: 'rgba(0, 0, 0, 0.55)',
                zIndex: 100000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: '4',
                backdropFilter: 'blur(2px)',
            })}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                style={{ width, maxWidth: '94vw', maxHeight: '90vh' }}
                className={css({
                    bg: 'background',
                    borderRadius: '14px',
                    border: '1px solid',
                    borderColor: 'border',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                })}
            >
                <div
                    className={css({
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderBottom: '1px solid',
                        borderColor: 'border',
                        flexShrink: 0,
                    })}
                >
                    <span className={css({ fontSize: '14px', fontWeight: '700', color: 'text' })}>{title}</span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="閉じる"
                        className={css({
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            border: 'none',
                            bg: 'transparent',
                            color: 'textMuted',
                            cursor: 'pointer',
                            fontSize: '18px',
                            lineHeight: '1',
                            _hover: { bg: 'surfaceHover' },
                        })}
                    >
                        ×
                    </button>
                </div>
                <div
                    className={css({
                        padding: '16px',
                        overflowY: 'auto',
                        flex: 1,
                    })}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
