import { type ReactNode, useEffect, useId, useRef } from 'react';
import { css } from '@/styled-system/css';
import { isCloseKey, useDialogLayer } from './dialogLayer';

const FIRST_FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * 手前に出す入力のダイアログ（パスワードの変更など）。外側を押すか Esc で閉じる（重なっていれば一番手前だけ）。
 * 開いたら最初の欄へフォーカスを移し、閉じたら開く前の場所へ戻す。`focusKey` が変わったとき（中身を切り替えたとき）も最初の欄へ移す。
 * 確認だけなら ConfirmProvider を使う。
 */
export function Dialog({
    open,
    title,
    onClose,
    children,
    focusKey,
    closeButton = false,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    focusKey?: string;
    /** 右上に閉じるボタンを出す（中に「やめる」が無いダイアログ向け） */
    closeButton?: boolean;
}) {
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    // 押し始めが外側だったときだけ閉じる（欄の文字を選んで外で離したときに閉じない）
    const pressedOutside = useRef(false);
    useDialogLayer(onClose, open);

    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return () => {
            if (opener?.isConnected) opener.focus();
        };
    }, [open]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: focusKey は中身を切り替えた合図として使う
    useEffect(() => {
        if (!open) return;
        const panel = panelRef.current;
        if (!panel || panel.contains(document.activeElement)) return;
        (panel.querySelector<HTMLElement>(FIRST_FIELD) ?? panel).focus();
    }, [open, focusKey]);

    if (!open) return null;
    return (
        <div
            className={backdrop}
            role="presentation"
            onMouseDown={(e) => {
                pressedOutside.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
                if (pressedOutside.current && e.target === e.currentTarget) onClose();
                pressedOutside.current = false;
            }}
        >
            <div
                ref={panelRef}
                className={panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                // 入力中のキーを HUD のショートカットに渡さない。Esc だけは閉じる合図として window（useDialogLayer）まで通す
                onKeyDown={(e) => {
                    if (!isCloseKey(e.nativeEvent)) e.stopPropagation();
                }}
            >
                <div className={header}>
                    <h2 id={titleId} className={css({ fontSize: 'lg', fontWeight: '700', color: 'text' })}>
                        {title}
                    </h2>
                    {closeButton && (
                        <button type="button" className={close} aria-label="閉じる" onClick={onClose}>
                            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    d="M6 6l12 12M18 6L6 18"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    fill="none"
                                />
                            </svg>
                        </button>
                    )}
                </div>
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
    maxH: 'full',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '4',
    p: '6',
    bg: 'surfaceAccent',
    borderRadius: '16px',
    boxShadow: 'modal',
    _focusVisible: { outline: 'none' },
});

const header = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' });

const close = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '36px',
    h: '36px',
    mr: '-2',
    flexShrink: 0,
    color: 'textMuted',
    rounded: 'full',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover', color: 'text' },
    _focusVisible: { outline: '2px solid token(colors.primary)', outlineOffset: '2px' },
});
