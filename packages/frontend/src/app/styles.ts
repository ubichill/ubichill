import { css } from '../../styled-system/css';
import { flex, hstack, vstack } from '../../styled-system/patterns';

/**
 * Centralized PandaCSS style definitions
 * Organized by component type for better readability and reusability
 */

// Layout Styles
export const mainContainer = flex({
    minH: 'screen',
    direction: 'column',
    alignItems: 'center',
    justify: 'space-between',
    p: '24',
});

export const headerContainer = css({
    zIndex: 10,
    w: 'full',
    maxW: '5xl',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontFamily: 'mono',
    fontSize: 'sm',
    lg: { display: 'flex' },
});

export const statusBar = css({
    pos: 'fixed',
    left: 0,
    top: 0,
    display: 'flex',
    w: 'full',
    justifyContent: 'center',
    borderBottomWidth: '1px',
    borderColor: 'border',
    bg: { base: 'zinc.200', _dark: 'zinc.800/30' },
    pb: '6',
    pt: '8',
    backdropFilter: 'blur(16px)',
    lg: {
        pos: 'static',
        w: 'auto',
        rounded: 'xl',
        borderWidth: '1px',
        bg: 'gray.200',
        p: '4',
    },
});

export const userInfo = css({
    pos: 'fixed',
    right: 0,
    top: 0,
    p: '4',
});

// Login Screen Styles
export const loginContainer = vstack({
    gap: '4',
    alignItems: 'center',
});

export const title = css({
    fontSize: '4xl',
    fontWeight: 'bold',
});

export const loginForm = hstack({
    gap: '2',
});

// Form Elements - Cute & Simple Design
export const input = css({
    p: '2',
    borderWidth: '1px',
    borderColor: 'border',
    rounded: 'md',
    color: 'text',
});

export const button = css({
    p: '2',
    bg: 'blue.500',
    color: 'white',
    rounded: 'md',
    _hover: { bg: 'blue.600' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});

// Room/Canvas Styles
export const roomCanvas = css({
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
    color: 'red.500',
    ml: '4',
});
