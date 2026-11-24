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

/** 見る人が入れない行き先。窓の上を暗くして鍵を出す（窓を囲む position: relative の要素の中に置く）。 */
export const portalLockShade = css({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'full',
    bg: 'bannerShade',
    color: 'textOnPrimary',
});

/** 部屋で置くポータルの並び（名前・窓・置いた人）。置く場所を選ぶ間のゴーストも同じ形にする。 */
export const roomPortalColumn = css({ display: 'flex', flexDirection: 'column', alignItems: 'center' });

// 名前は幅いっぱいまで出し、窓は少し小さくする（行き先の名前が切れにくいように）
export const roomPortalFrame = css({ position: 'relative', w: '140px', maxW: 'full', display: 'block' });
