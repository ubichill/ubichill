import { css, cva } from '@/styled-system/css';

/** コントロールパネルの欄の中身（縦に並べる）。 */
export const adminStack = css({ display: 'flex', flexDirection: 'column', gap: '4', maxW: '720px' });

export const adminNote = css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.6' });

export const adminError = css({ fontSize: '13px', color: 'errorText' });

export const adminList = css({ display: 'flex', flexDirection: 'column', gap: '1.5' });

/** 一覧の 1 行（ユーザー・ロール・メンバー）。 */
export const adminRow = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '3',
        px: '3',
        py: '2.5',
        borderRadius: '10px',
        bg: 'surface',
        border: '1px solid',
        borderColor: 'transparent',
        minW: 0,
    },
    variants: {
        interactive: {
            true: {
                w: 'full',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background-color 0.16s ease, border-color 0.16s ease',
                _hover: { bg: 'surfaceHover', borderColor: 'border' },
            },
        },
        wrap: { true: { flexWrap: 'wrap' } },
    },
});

export const adminField = cva({
    base: {
        w: 'full',
        px: '3',
        py: '2',
        border: '1px solid',
        borderColor: 'border',
        borderRadius: '8px',
        fontSize: '14px',
        bg: 'background',
        color: 'text',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        multiline: { true: { minH: '80px', resize: 'vertical', lineHeight: '1.6' } },
        compact: { true: { w: 'auto', px: '2', py: '1.5', fontSize: '13px', cursor: 'pointer' } },
        /** 横に並べた行の残りの幅を使う（検索の欄） */
        grow: { true: { flex: 1, minW: '180px', w: 'auto' } },
    },
});

export const adminLabel = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '1',
    fontSize: '13px',
    fontWeight: '600',
    color: 'text',
});

export const adminButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5',
        flexShrink: 0,
        px: '3.5',
        py: '2',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '700',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease, opacity 0.16s ease',
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { bg: 'primaryHover' } },
            secondary: { bg: 'background', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
            danger: { bg: 'errorBg', color: 'errorText', borderColor: 'errorSubtle', _hover: { opacity: 0.85 } },
        },
    },
    defaultVariants: { tone: 'secondary' },
});

/** 小さな丸いアイコンのボタン（外す・戻る）。 */
export const adminIconButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    w: '28px',
    h: '28px',
    border: 'none',
    borderRadius: 'full',
    bg: 'transparent',
    color: 'textMuted',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover', color: 'text' },
    _disabled: { opacity: 0.4, cursor: 'not-allowed' },
});

/** 状態の小さな印（公開・管理者・ルート）。 */
export const adminTag = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1',
        flexShrink: 0,
        px: '1.5',
        py: '0.5',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '700',
        whiteSpace: 'nowrap',
    },
    variants: {
        tone: {
            neutral: { bg: 'surfaceAccent', color: 'textMuted' },
            strong: { bg: 'primary', color: 'textOnPrimary' },
        },
    },
    defaultVariants: { tone: 'neutral' },
});

export const adminAvatar = css({
    w: '36px',
    h: '36px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'full',
    objectFit: 'cover',
    bg: 'surfaceAccent',
    color: 'textMuted',
    fontSize: '14px',
    fontWeight: '800',
});

/** 名前と ID（縦に 2 行。行の残りの幅を使う） */
export const adminIdentity = css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column' });
export const adminName = css({ fontSize: '14px', fontWeight: '700', color: 'text', overflowWrap: 'anywhere' });
export const adminHandle = css({ fontSize: '12px', color: 'textMuted', overflowWrap: 'anywhere' });
