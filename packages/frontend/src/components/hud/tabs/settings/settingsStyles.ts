import { css } from '@/styled-system/css';

/** 設定の欄の中の 1 まとまり（見出しと中身）。 */
export const settingsGroup = css({ display: 'flex', flexDirection: 'column', gap: '2' });
export const settingsHeading = css({ fontSize: '13px', fontWeight: '700', color: 'text' });
export const settingsNote = css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.6' });

/** 設定の欄の入力欄。 */
export const settingsInput = css({
    w: 'full',
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    fontSize: '14px',
    bg: 'background',
    color: 'text',
});

export const settingsLabel = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '1',
    fontSize: '12px',
    color: 'textMuted',
});

/** 欄の幅いっぱいの主なボタン（追加する・確かめる）。 */
export const settingsWideButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2',
    w: 'full',
    minH: '40px',
    px: '4',
    fontSize: '13px',
    fontWeight: '700',
    color: 'textOnPrimary',
    bg: 'primary',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});

/** 控えめな文字のボタン（やめる・送り直す）。 */
export const settingsTextButton = css({
    alignSelf: 'flex-start',
    p: '0',
    fontSize: '12px',
    fontWeight: '700',
    color: 'textMuted',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    _hover: { color: 'text' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});

/** 設定の欄の 1 まとまり（パスワード・ログイン方法・ログイン中の端末）。 */
export const settingsCard = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    p: '4',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
});

export const settingsCardTitle = css({ fontSize: 'lg', fontWeight: '700', color: 'text' });

/** 枠だけのボタン（パスワードを変更・すべてログアウト）。 */
export const settingsOutlineButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2',
    w: 'full',
    minH: '40px',
    px: '4',
    fontSize: '13px',
    fontWeight: '700',
    color: 'text',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
