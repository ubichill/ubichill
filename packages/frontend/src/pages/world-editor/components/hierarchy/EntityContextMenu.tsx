import { useEffect } from 'react';
import { css } from '@/styled-system/css';

export interface EntityContextMenuItem {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    /** 区切り線をこの項目の上に入れる */
    separatorAbove?: boolean;
    /** 赤字 (destructive action) */
    danger?: boolean;
}

interface EntityContextMenuProps {
    x: number;
    y: number;
    items: EntityContextMenuItem[];
    onClose: () => void;
}

/**
 * 右クリックで開く小型コンテキストメニュー。
 *
 * Hierarchy 専用ではなく、items 配列を渡せば任意のメニューを表示できる。
 * 表示位置 (x, y) はクライアント座標 (mouse event 由来) を想定。
 * Esc / メニュー外クリック / 項目クリックで自動 close。
 */
export function EntityContextMenu({ x, y, items, onClose }: EntityContextMenuProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const onClick = () => onClose();
        // capture=true で、メニュー内 button の click より早く起こるのを防ぐため
        // stopPropagation を併用する (下の onClick={(e) => e.stopPropagation()}).
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onClick);
        window.addEventListener('contextmenu', onClick);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('contextmenu', onClick);
        };
    }, [onClose]);

    return (
        <ul
            className={css({
                position: 'fixed',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '6px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                padding: '4px',
                minWidth: '160px',
                listStyle: 'none',
                zIndex: 9999,
                fontSize: '12px',
                userSelect: 'none',
            })}
            // 画面端で見切れないようクランプ
            style={{
                left: Math.min(x, window.innerWidth - 200),
                top: Math.min(y, window.innerHeight - items.length * 28 - 16),
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((item, i) => (
                <li
                    key={`${item.label}-${i}`}
                    className={css({
                        display: item.separatorAbove && i > 0 ? 'block' : 'block',
                    })}
                >
                    {item.separatorAbove && i > 0 && (
                        <div
                            className={css({
                                height: '1px',
                                bg: 'border',
                                margin: '4px 0',
                            })}
                            aria-hidden
                        />
                    )}
                    <button
                        type="button"
                        disabled={item.disabled}
                        onClick={() => {
                            if (item.disabled) return;
                            item.onClick();
                            onClose();
                        }}
                        className={css({
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            border: 'none',
                            bg: 'transparent',
                            color: 'text',
                            cursor: 'pointer',
                            fontSize: '12px',
                            _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                            _hover: { bg: 'surfaceHover' },
                        })}
                        style={{ color: item.danger ? 'var(--colors-danger, #d33)' : undefined }}
                    >
                        {item.label}
                    </button>
                </li>
            ))}
        </ul>
    );
}
