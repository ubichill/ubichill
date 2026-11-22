import { css } from '@/styled-system/css';

/** 本体の部品のボタン（ポータル・ワープ・スイッチ）。Entity の矩形いっぱいに置く。 */
export const partButton = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2',
    w: 'full',
    h: 'full',
    minW: '96px',
    minH: '44px',
    px: '4',
    py: '2',
    bg: 'white',
    color: 'primary',
    border: '2px solid',
    borderColor: 'primary',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'surfaceHover' },
    _disabled: { cursor: 'default', _hover: { bg: 'white' } },
});

export const partButtonLabel = css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
