import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';

interface ConfirmModalProps {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * 共通の確認モーダルコンポーネント。
 */
export function ConfirmModal({ isOpen, message, onConfirm, onCancel }: ConfirmModalProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            requestAnimationFrame(() => setVisible(true));
        } else {
            setVisible(false);
        }
    }, [isOpen]);

    // ESC キーでモーダルを閉じる
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 10020,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 0.2s ease',
            })}
            style={{
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                opacity: visible ? 1 : 0,
            }}
            onClick={onCancel}
        >
            <div
                className={css({
                    width: '100%',
                    maxWidth: '400px',
                    mx: '4',
                    bg: 'surfaceAccent',
                    borderRadius: '16px',
                    p: '24px',
                    boxShadow: 'modal',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px',
                    transition: 'opacity 0.2s ease, transform 0.2s ease',
                })}
                style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? 'scale(1)' : 'scale(0.96)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <p
                    className={css({
                        fontSize: '16px',
                        color: 'text',
                        textAlign: 'center',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-wrap',
                    })}
                >
                    {message}
                </p>
                <div className={css({ display: 'flex', gap: '12px', justifyContent: 'center' })}>
                    <button
                        type="button"
                        onClick={onCancel}
                        className={css({
                            flex: 1,
                            padding: '10px 0',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: 'secondary',
                            color: 'text',
                            fontSize: '14px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s ease, opacity 0.2s ease',
                            _hover: { opacity: 0.8 },
                        })}
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className={css({
                            flex: 1,
                            padding: '10px 0',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: 'primary',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s ease, opacity 0.2s ease',
                            _hover: { backgroundColor: 'primaryHover' },
                        })}
                    >
                        確認
                    </button>
                </div>
            </div>
        </div>
    );
}
