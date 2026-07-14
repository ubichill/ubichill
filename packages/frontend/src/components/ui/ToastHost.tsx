/**
 * ToastHost — トースト通知の表示ホスト。アプリ全体で 1 つ配置する。
 * `lib/toast` のモジュールストアを useSyncExternalStore で購読して描画する。
 */
import { useSyncExternalStore } from 'react';
import { dismissToast, getToasts, subscribeToasts, type ToastLevel } from '@/lib/toast';
import { css } from '@/styled-system/css';

const LEVEL_COLOR: Record<ToastLevel, { bg: string; fg: string }> = {
    info: { bg: 'surfaceAccent', fg: 'text' },
    warn: { bg: 'warning', fg: 'text' },
    error: { bg: 'errorBg', fg: 'errorText' },
};

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

export function ToastHost() {
    const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
    if (toasts.length === 0) return null;

    return (
        <div
            className={css({
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: 10040,
                display: 'flex',
                flexDirection: 'column',
                gap: '2',
                maxWidth: 'min(360px, calc(100vw - 40px))',
                pointerEvents: 'none',
            })}
        >
            {toasts.map((toast) => {
                const color = LEVEL_COLOR[toast.level];
                return (
                    <div
                        key={toast.id}
                        className={css({
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '3',
                            px: '4',
                            py: '3',
                            borderRadius: '12px',
                            boxShadow: 'modal',
                            fontSize: '13px',
                            lineHeight: '1.5',
                            pointerEvents: 'auto',
                            bg: color.bg,
                            color: color.fg,
                        })}
                    >
                        <span className={css({ flex: 1, minW: 0, wordBreak: 'break-word' })}>{toast.message}</span>
                        {toast.action && (
                            <button
                                type="button"
                                onClick={() => {
                                    toast.action?.run();
                                    dismissToast(toast.id);
                                }}
                                className={css({
                                    flexShrink: 0,
                                    px: '3',
                                    py: '1',
                                    borderRadius: '8px',
                                    border: 'none',
                                    bg: 'primary',
                                    color: 'textOnPrimary',
                                    fontSize: '12px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    _hover: { bg: 'primaryHover' },
                                })}
                            >
                                {toast.action.label}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => dismissToast(toast.id)}
                            aria-label="閉じる"
                            className={css({
                                flexShrink: 0,
                                display: 'flex',
                                border: 'none',
                                bg: 'transparent',
                                color: 'inherit',
                                cursor: 'pointer',
                                opacity: 0.7,
                                _hover: { opacity: 1 },
                            })}
                        >
                            <CloseIcon />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
