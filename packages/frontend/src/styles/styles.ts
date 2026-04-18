import { css } from '@/styled-system/css';
import { flex } from '@/styled-system/patterns';

export const mainContainer = flex({
    minH: 'screen',
    direction: 'column',
    px: { base: '4', md: '8' },
    py: { base: '4', md: '6' },
    position: 'relative',
    bg: 'background',
    overflow: 'hidden',
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
    bg: 'glassBg',
    color: 'text',
    px: '4',
    py: '2',
    fontSize: 'sm',
    backdropFilter: 'blur(8px)',
});

export const errorText = css({
    color: 'errorLight',
    ml: '2',
});
