import { type ReactNode, useId } from 'react';
import { css } from '@/styled-system/css';
import { useDialogLayer } from './dialogLayer';

/**
 * 手前に出す入力のダイアログ（パスワードの変更など）。外側を押すか Esc で閉じる（重なっていれば一番手前だけ）。
 * 確認だけなら ConfirmProvider を使う。
 */
export function Dialog({
    open,
    title,
    onClose,
    children,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const titleId = useId();
    useDialogLayer(onClose, open);
    if (!open) return null;
    return (
        <div className={backdrop} onClick={onClose} role="presentation">
            <div
                className={panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <h2 id={titleId} className={css({ fontSize: 'lg', fontWeight: '700', color: 'text' })}>
                    {title}
                </h2>
                {children}
            </div>
        </div>
    );
}

const backdrop = css({
    position: 'fixed',
    inset: 0,
    zIndex: 10020,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: '4',
    bg: 'hudBackdrop',
    backdropFilter: 'blur(4px)',
});

const panel = css({
    w: 'full',
    maxW: '420px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4',
    p: '6',
    bg: 'surfaceAccent',
    borderRadius: '16px',
    boxShadow: 'modal',
});
