import { cva } from '@/styled-system/css';

/**
 * エディタ画面共通のボタン Recipe。
 * - intent: 用途 (primary / secondary / icon / danger / success / toggleOn / menu*)
 * - size: 高さ系統 (sm / md / lg / iconSm / menu)
 */
export const editorButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        border: '1px solid',
        borderRadius: '8px',
        fontWeight: '600',
        cursor: 'pointer',
        userSelect: 'none',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        intent: {
            primary: {
                bg: 'primary',
                color: 'textOnPrimary',
                borderColor: 'primary',
                _hover: { opacity: 0.9 },
            },
            secondary: {
                bg: 'surface',
                color: 'text',
                borderColor: 'border',
                _hover: { borderColor: 'primary' },
            },
            toggleOn: {
                bg: 'primary',
                color: 'textOnPrimary',
                borderColor: 'primary',
                _hover: { borderColor: 'primary' },
            },
            danger: {
                bg: 'errorBg',
                color: 'errorText',
                borderColor: 'errorLight',
                _hover: { opacity: 0.9 },
            },
            success: {
                bg: 'success',
                color: 'text',
                borderColor: 'success',
                _hover: { opacity: 0.9 },
            },
            icon: {
                bg: 'surface',
                color: 'textMuted',
                borderColor: 'border',
                _hover: { borderColor: 'borderStrong' },
            },
            menu: {
                bg: 'transparent',
                color: 'text',
                borderColor: 'transparent',
                width: '100%',
                justifyContent: 'flex-start',
                _hover: { bg: 'surfaceAccent' },
            },
            menuPrimary: {
                bg: 'primary',
                color: 'textOnPrimary',
                borderColor: 'primary',
                width: '100%',
                justifyContent: 'flex-start',
                _hover: { opacity: 0.9 },
            },
            menuDanger: {
                bg: 'errorBg',
                color: 'errorText',
                borderColor: 'errorBg',
                width: '100%',
                justifyContent: 'flex-start',
                _hover: { bg: 'errorLight' },
            },
        },
        size: {
            sm: { padding: '4px 10px', fontSize: '11px' },
            md: { padding: '7px 12px', fontSize: '13px' },
            lg: { padding: '8px 16px', fontSize: '13px' },
            iconSm: { width: '32px', height: '32px', padding: '0' },
            menu: { padding: '8px 10px', fontSize: '13px' },
        },
    },
    defaultVariants: { intent: 'secondary', size: 'md' },
});
