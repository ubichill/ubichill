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
