import { css } from '@/styled-system/css';

interface MobileRightHandleProps {
    onClick: () => void;
}

/**
 * モバイル専用: 画面右端に表示する細いタブ。押すとインスペクタ drawer が開く。
 * エンティティが選択されている時だけ表示する想定。md 以上では非表示。
 */
export function MobileRightHandle({ onClick }: MobileRightHandleProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="設定を開く"
            className={css({
                display: { base: 'flex', md: 'none' },
                position: 'fixed',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 70,
                width: '24px',
                height: '88px',
                bg: 'primary',
                color: 'textOnPrimary',
                border: 'none',
                borderRadius: '10px 0 0 10px',
                cursor: 'pointer',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'chipDrop',
                _active: { opacity: 0.8 },
            })}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
            </svg>
        </button>
    );
}
