import { css } from '@/styled-system/css';
import { flex } from '@/styled-system/patterns';

/**
 * Centralized PandaCSS style definitions
 * Organized by component type for better readability and reusability
 */

// Layout Styles
export const mainContainer = flex({
    minH: 'screen',
    direction: 'column',
    px: { base: '4', md: '8' },
    py: { base: '4', md: '6' },
    position: 'relative',
    bg: 'background',
    overflow: 'hidden',
});

export const shell = css({
    width: 'full',
    maxW: '5xl',
    mx: 'auto',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
});

export const headerContainer = css({
    zIndex: 2,
    w: 'full',
    alignItems: 'center',
    justifyContent: 'space-between',
    display: 'flex',
    mb: '4',
});

export const statusBar = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    rounded: 'full',
    borderWidth: '1px',
    borderColor: 'border',
    bg: 'rgba(255, 255, 255, 0.72)',
    color: 'text',
    px: '4',
    py: '2',
    fontSize: 'sm',
    backdropFilter: 'blur(8px)',
});

export const userInfo = css({
    color: 'text',
    fontSize: 'sm',
});

// Login Screen Styles
export const loginContainer = css({
    width: 'full',
    maxW: '2xl',
    mx: 'auto',
    mt: { base: '6', md: '10' },
    rounded: '3xl',
    px: { base: '6', md: '10' },
    py: { base: '8', md: '12' },
    bg: '#ffffff',
    borderWidth: '1px',
    borderColor: 'border',
    boxShadow: '0 8px 32px rgba(27, 42, 68, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '4',
});

export const titleTag = css({
    fontSize: 'xs',
    fontWeight: '600',
    letterSpacing: '0.18em',
    color: 'textMuted',
    textTransform: 'uppercase',
});

export const title = css({
    fontSize: { base: '4xl', md: '5xl' },
    fontWeight: '700',
    color: 'text',
    lineHeight: '1.1',
});

export const subtitle = css({
    color: 'textMuted',
    fontSize: { base: 'sm', md: 'md' },
});

export const loginForm = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    mt: '2',
});

// Form Elements - Cute & Simple Design
export const input = css({
    px: '4',
    py: '3',
    borderWidth: '1px',
    borderColor: 'border',
    rounded: 'lg',
    color: 'text',
    bg: 'surfaceHover',
    fontSize: 'md',
    _placeholder: { color: 'textSubtle' },
    _focusVisible: {
        outline: 'none',
        borderColor: 'primaryHover',
        boxShadow: '0 0 0 3px rgba(30, 49, 85, 0.15)',
    },
});

export const button = css({
    px: '4',
    py: '3',
    bg: 'primaryHover',
    color: 'textOnPrimary',
    rounded: 'lg',
    fontWeight: '600',
    transition: 'background-color 0.16s ease, opacity 0.16s ease',
    _hover: { bg: 'primaryActive' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});

// World/Canvas Styles
export const worldCanvas = css({
    pos: 'relative',
    w: 'full',
    h: '600px',
    borderWidth: '1px',
    borderColor: 'white/5',
    rounded: 'lg',
    bg: 'white/5',
});

export const userListContainer = css({
    pos: 'absolute',
    top: '4',
    left: '4',
});

export const userListTitle = css({
    fontSize: 'xl',
});

export const userList = css({
    listStyleType: 'disc',
    pl: '5',
});

// Cursor & Interactive Elements
export const cursor = css({
    pos: 'absolute',
    w: '4',
    h: '4',
    bg: 'red.500/50',
    rounded: 'full',
    pointerEvents: 'none',
    transitionProperty: 'all',
    transitionDuration: '100ms',
    transitionTimingFunction: 'linear',
});

export const cursorLabel = css({
    pos: 'absolute',
    top: '-6',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 'xs',
    bg: 'black/70',
    color: 'white',
    px: '1',
    rounded: 'sm',
    whiteSpace: 'nowrap',
});

// Status & Error Text
export const errorText = css({
    color: '#ff8f8f',
    ml: '2',
});
