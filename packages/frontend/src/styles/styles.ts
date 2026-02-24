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
    bg: '#0f1a2d',
    overflow: 'hidden',
});

export const texturedBackdrop = css({
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    bgImage:
        'radial-gradient(circle at 20% 10%, rgba(232, 216, 192, 0.12), transparent 40%), radial-gradient(circle at 80% 80%, rgba(232, 216, 192, 0.08), transparent 45%), linear-gradient(to bottom, rgba(255, 255, 255, 0.03), transparent)',
    opacity: 1,
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
    borderColor: 'rgba(230,216,197,0.3)',
    bg: 'rgba(22, 37, 66, 0.72)',
    color: '#e8ddcc',
    px: '4',
    py: '2',
    fontSize: 'sm',
    backdropFilter: 'blur(8px)',
});

export const userInfo = css({
    color: '#e8ddcc',
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
    bg: '#e6d7c4',
    borderWidth: '1px',
    borderColor: 'rgba(27,42,68,0.08)',
    boxShadow: '0 24px 48px rgba(5, 11, 23, 0.35)',
    display: 'flex',
    flexDirection: 'column',
    gap: '4',
});

export const titleTag = css({
    fontSize: 'xs',
    fontWeight: '600',
    letterSpacing: '0.18em',
    color: '#5e6a82',
});

export const title = css({
    fontSize: { base: '4xl', md: '5xl' },
    fontWeight: '700',
    color: '#1b2a44',
    lineHeight: '1.1',
});

export const brandTitleRow = css({
    display: 'flex',
    alignItems: 'center',
    gap: { base: '3', md: '4' },
});

export const brandIcon = css({
    width: { base: '48px', md: '56px' },
    height: { base: '48px', md: '56px' },
    flexShrink: 0,
    filter: 'drop-shadow(0 6px 10px rgba(27, 42, 68, 0.14))',
});

export const subtitle = css({
    color: '#445775',
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
    borderColor: '#cebca2',
    rounded: 'lg',
    color: '#1f2f4c',
    bg: '#f5ecdf',
    fontSize: 'md',
    _placeholder: { color: '#777069' },
    _focusVisible: {
        outline: 'none',
        borderColor: '#2e446f',
        boxShadow: '0 0 0 3px rgba(30, 49, 85, 0.2)',
    },
});

export const button = css({
    px: '4',
    py: '3',
    bg: '#1e3155',
    color: '#f8f3ea',
    rounded: 'lg',
    fontWeight: '600',
    transition: 'background-color 0.16s ease, opacity 0.16s ease',
    _hover: { bg: '#263d68' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});

export const hintText = css({
    fontSize: 'xs',
    color: '#5a6a85',
});

export const backButton = css({
    px: '4',
    py: '2',
    bg: 'transparent',
    color: '#d7ccb9',
    borderWidth: '1px',
    borderColor: 'rgba(230,216,197,0.35)',
    rounded: 'lg',
    cursor: 'pointer',
    fontSize: 'sm',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'rgba(230,216,197,0.1)' },
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
