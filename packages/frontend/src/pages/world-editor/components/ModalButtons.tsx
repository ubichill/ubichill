import { css } from '@/styled-system/css';

/**
 * モーダルフッター用のプライマリボタン（適用 / 保存）。
 */
export function ModalPrimaryButton({
    onClick,
    children,
    disabled,
    title,
}: {
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
    title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={css({
                padding: '8px 16px',
                bg: 'primary',
                color: 'textOnPrimary',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                _hover: { opacity: 0.9 },
            })}
        >
            {children}
        </button>
    );
}

/**
 * モーダルフッター用のセカンダリボタン（キャンセル）。
 */
export function ModalSecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={css({
                padding: '8px 16px',
                bg: 'surface',
                color: 'textMuted',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            {children}
        </button>
    );
}
