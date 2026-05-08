import { css } from '@/styled-system/css';

interface MobileLeftHandleProps {
    onClick: () => void;
}

/**
 * モバイル専用: 画面左端に常時表示する細いタブ。押すとヒエラルキー drawer が開く。
 * md 以上では非表示。
 */
export function MobileLeftHandle({ onClick }: MobileLeftHandleProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="ヒエラルキーを開く"
            className={css({
                display: { base: 'flex', md: 'none' },
                position: 'fixed',
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 70,
                width: '24px',
                height: '88px',
                bg: 'primary',
                color: 'textOnPrimary',
                border: 'none',
                borderRadius: '0 10px 10px 0',
                cursor: 'pointer',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '2px 2px 8px rgba(0,0,0,0.3)',
                _active: { opacity: 0.8 },
            })}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 18l6-6-6-6" />
            </svg>
        </button>
    );
}
