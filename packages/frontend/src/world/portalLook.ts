import { css } from '@/styled-system/css';

/** ポータルの見た目（行き先の名前と、サムネイルの丸い窓）。ワールドに置くものと部屋で置くもので同じにする。 */
export const portal = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2',
    w: 'full',
    minW: '96px',
    // 窓の外側の輪（ホバーで太くなる）を、Entity の矩形の中に収める
    p: '3',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    _disabled: { cursor: 'default' },
});

export const portalName = css({
    maxW: 'full',
    px: '3',
    py: '1',
    bg: 'background',
    color: 'text',
    borderRadius: 'full',
    fontSize: '15px',
    fontWeight: 'bold',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const portalWindow = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: 'full',
    aspectRatio: '1 / 1',
    borderRadius: 'full',
    overflow: 'hidden',
    bg: 'surface',
    color: 'primary',
    border: '4px solid',
    borderColor: 'primaryHighlight',
    outline: '6px solid',
    outlineColor: 'primarySubtle',
    transition: 'transform 0.2s ease, outline-width 0.2s ease',
    '[data-portal] button:enabled:hover &': { transform: 'scale(1.03)', outlineWidth: '8px' },
    '[data-portal] button:focus-visible &': { outlineColor: 'primaryHighlight' },
});

export const portalImage = css({ w: 'full', h: 'full', objectFit: 'cover' });
