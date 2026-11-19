import { css } from '@/styled-system/css';
import { flex, vstack } from '@/styled-system/patterns';

/** ログイン・登録の画面の見た目（AuthPage とフェディバースのログインで共用）。 */
export const containerStyle = flex({
    minH: '100dvh',
    px: { base: '4', sm: '6' },
    py: '6',
    alignItems: 'center',
    justifyContent: 'center',
    bg: 'background',
});

export const cardStyle = vstack({
    gap: '6',
    p: { base: '6', sm: '8' },
    bg: 'white',
    rounded: 'lg',
    border: '1px solid',
    borderColor: 'border',
    w: 'full',
    maxW: '400px',
});

export const iconStyle = css({
    borderRadius: '14px',
});

export const titleStyle = css({
    fontSize: { base: '2xl', sm: '3xl' },
    fontWeight: 'bold',
    color: 'text',
    wordBreak: 'auto-phrase',
});

export const subtitleStyle = css({
    fontSize: 'sm',
    color: 'textMuted',
    textAlign: 'center',
    lineHeight: '1.7',
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});

export const tabContainerStyle = flex({
    w: 'full',
    gap: '2',
    bg: 'surfaceHover',
    p: '1',
    rounded: 'lg',
});

export const tabStyle = css({
    flex: 1,
    whiteSpace: 'nowrap',
    minH: '44px',
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textMuted',
    rounded: 'md',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { color: 'text' },
});

export const tabActiveStyle = css({
    flex: 1,
    whiteSpace: 'nowrap',
    minH: '44px',
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textOnPrimary',
    bg: 'primaryHover',
    rounded: 'md',
    cursor: 'pointer',
});

export const formStyle = vstack({
    gap: '4',
    w: 'full',
});

export const fieldStyle = vstack({
    gap: '1',
    w: 'full',
    alignItems: 'flex-start',
});

export const labelStyle = css({
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textMuted',
});

export const inputStyle = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '3',
    fontSize: 'md',
    color: 'text',
    bg: 'surfaceHover',
    borderWidth: '1px',
    borderColor: 'border',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _placeholder: { color: 'textSubtle' },
    _focus: { borderColor: 'primaryHover', ring: '2', ringColor: 'primarySubtle' },
    '&[data-password]': { pr: '16' },
});

export const inputErrorStyle = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '3',
    fontSize: 'md',
    color: 'text',
    bg: 'surfaceHover',
    borderWidth: '1px',
    borderColor: 'error',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _placeholder: { color: 'textSubtle' },
    _focus: { borderColor: 'error', ring: '2', ringColor: 'errorSubtle' },
});

export const fieldErrorStyle = css({
    fontSize: 'xs',
    color: 'error',
});

export const fieldSuccessStyle = css({
    fontSize: 'xs',
    color: 'successText',
});

export const hintStyle = css({
    fontSize: 'xs',
    color: 'textSubtle',
    lineHeight: '1.6',
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});

export const otpInputStyle = css({
    w: 'full',
    py: '4',
    px: '4',
    fontSize: '2xl',
    fontWeight: 'bold',
    color: 'text',
    textAlign: 'center',
    letterSpacing: '0.5em',
    bg: 'surfaceHover',
    borderWidth: '2px',
    borderColor: 'border',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _focus: { borderColor: 'primaryHover', ring: '2', ringColor: 'primarySubtle' },
});

export const buttonStyle = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textOnPrimary',
    bg: 'primaryHover',
    rounded: 'lg',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { bg: 'primaryActive' },
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});

export const linkButtonStyle = css({
    minH: '44px',
    py: '2',
    fontSize: 'sm',
    color: 'textMuted',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { color: 'text' },
});

export const passwordToggleStyle = css({
    position: 'absolute',
    right: '1',
    top: '0',
    bottom: '0',
    minW: '48px',
    px: '2',
    color: 'text',
    fontSize: 'sm',
    fontWeight: 'medium',
    cursor: 'pointer',
    rounded: 'md',
    _hover: { bg: 'surfaceAccent' },
    _focusVisible: { outline: '2px solid token(colors.primary)', outlineOffset: '2px' },
});

export const errorStyle = css({
    w: 'full',
    py: '2',
    px: '3',
    fontSize: 'sm',
    color: 'errorText',
    bg: 'errorBg',
    rounded: 'lg',
});

export const successStyle = css({
    w: 'full',
    py: '2',
    px: '3',
    fontSize: 'sm',
    color: 'successText',
    bg: 'successBg',
    rounded: 'lg',
});

export const verifyInfoStyle = css({
    w: 'full',
    py: '4',
    px: '4',
    fontSize: 'sm',
    color: 'textMuted',
    bg: 'surfaceHover',
    rounded: 'lg',
});

export const verifyListStyle = css({
    mt: '2',
    ml: '4',
    listStyleType: 'disc',
    fontSize: 'xs',
    color: 'textMuted',
    '& li': {
        mt: '1',
    },
});

export const dividerStyle = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    w: 'full',
    fontSize: 'xs',
    color: 'textMuted',
    _before: { content: '""', flex: 1, h: '1px', bg: 'border' },
    _after: { content: '""', flex: 1, h: '1px', bg: 'border' },
});
