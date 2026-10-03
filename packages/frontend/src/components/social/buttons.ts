import { cva } from '@/styled-system/css';

/** ソーシャル画面のボタン。 */
export const socialButton = cva({
    base: {
        px: '3',
        py: '1.5',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { opacity: 0.9 } },
            secondary: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
            danger: { bg: 'surface', color: 'errorText', borderColor: 'border', _hover: { bg: 'errorBg' } },
        },
    },
    defaultVariants: { tone: 'secondary' },
});
