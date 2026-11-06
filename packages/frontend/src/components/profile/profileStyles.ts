import { css, cva } from '@/styled-system/css';

/** プロフィールのカード（バナー・アイコン・本文）。表示と編集で同じ骨組みにする。 */
export const profileCard = css({
    bg: 'surface',
    borderRadius: '20px',
    overflow: 'hidden',
    mb: '4',
    boxShadow: 'card',
});

export const profileBody = css({
    px: { base: '4', md: '6' },
    pb: { base: '5', md: '6' },
    display: 'flex',
    flexDirection: 'column',
    gap: '4',
});

/** アイコンの行（バナーの下端に重ね、右にひとことを並べる） */
export const avatarRow = css({
    display: 'flex',
    alignItems: 'flex-end',
    gap: '3',
    mt: { base: '-48px', md: '-60px' },
    minW: 0,
});

export const profileSectionTitle = css({
    fontSize: '13px',
    fontWeight: '700',
    color: 'textMuted',
    letterSpacing: '0.04em',
    mb: '2',
});

export const profileButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2',
        border: '1px solid',
        borderRadius: '12px',
        fontWeight: '700',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, opacity 0.15s',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: {
                bg: 'primary',
                color: 'textOnPrimary',
                borderColor: 'primary',
                _hover: { bg: 'primaryHover' },
            },
            secondary: { bg: 'background', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
        },
        size: {
            md: { px: '4', py: '2', fontSize: '13px' },
            lg: { px: '5', py: '2.5', fontSize: '14px' },
        },
        grow: { true: { flex: 1 } },
    },
    defaultVariants: { tone: 'secondary', size: 'md' },
});

/** 丸いアイコンのボタン（リンク・共有・画像の変更） */
export const roundIconButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: 'full',
        border: '1px solid',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
        _focusVisible: { outline: '2px solid', outlineColor: 'primaryHighlight', outlineOffset: '2px' },
    },
    variants: {
        tone: {
            surface: {
                bg: 'background',
                color: 'text',
                borderColor: 'border',
                _hover: { bg: 'surfaceHover', borderColor: 'borderStrong' },
            },
            /** 画像の上に重ねる */
            overlay: {
                bg: 'hudBg',
                color: 'hudText',
                borderColor: 'hudBorder',
                _hover: { bg: 'hudBgHover' },
            },
        },
        size: {
            sm: { width: '32px', height: '32px' },
            md: { width: '42px', height: '42px' },
        },
    },
    defaultVariants: { tone: 'surface', size: 'md' },
});

export const chip = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1.5',
        px: '3',
        py: '1',
        borderRadius: 'full',
        border: '1px solid',
        fontSize: '13px',
        lineHeight: '1.5',
        whiteSpace: 'nowrap',
    },
    variants: {
        selected: {
            true: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary' },
            false: { bg: 'background', color: 'text', borderColor: 'border' },
        },
        interactive: {
            true: {
                cursor: 'pointer',
                _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                _focusVisible: { outline: '2px solid', outlineColor: 'primaryHighlight', outlineOffset: '2px' },
            },
        },
    },
    compoundVariants: [{ selected: false, interactive: true, css: { _hover: { borderColor: 'borderStrong' } } }],
    defaultVariants: { selected: false },
});

export const fieldInput = cva({
    base: {
        width: 'full',
        px: '3',
        py: '2',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '14px',
        lineHeight: '1.6',
        bg: 'background',
        color: 'text',
        _focus: { outline: 'none', borderColor: 'primaryHighlight' },
    },
    variants: {
        invalid: { true: { borderColor: 'errorText' }, false: { borderColor: 'border' } },
        multiline: { true: { resize: 'vertical', minH: '120px' } },
    },
    defaultVariants: { invalid: false },
});

export const fieldLabel = css({ fontSize: '13px', fontWeight: '700', color: 'text' });

export const fieldHint = cva({
    base: { fontSize: '12px' },
    variants: { tone: { muted: { color: 'textMuted' }, error: { color: 'errorText' } } },
    defaultVariants: { tone: 'muted' },
});
