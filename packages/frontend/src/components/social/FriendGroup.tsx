import type { ReactNode } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { css } from '@/styled-system/css';

/**
 * 見出しを押すと畳める 1 まとまり（部屋ごと・オンライン・オフラインなど）。開いているかは読み直しても保つ（DOM が持つ）。
 * meta は見出しの名前の後ろに小さく添える（公開範囲・サーバーなど）。
 */
export function FriendGroup({
    title,
    count,
    meta,
    children,
}: {
    title: ReactNode;
    count: number;
    meta?: ReactNode;
    children: ReactNode;
}) {
    return (
        <details open className={group}>
            <summary className={summary}>
                <span className={chevron}>
                    <HudIcon name="chevron" size={16} />
                </span>
                <span className={titleText}>{title}</span>
                {meta && <span className={metaText}>{meta}</span>}
                <span className={countText}>{count}</span>
            </summary>
            <div className={body}>{children}</div>
        </details>
    );
}

const group = css({
    '& + &': { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'border', pt: '3' },
});

const summary = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    minW: 0,
    py: '1.5',
    listStyle: 'none',
    cursor: 'pointer',
    userSelect: 'none',
    '&::-webkit-details-marker': { display: 'none' },
    _hover: { '& > span:first-child': { color: 'text' } },
});

const chevron = css({
    flexShrink: 0,
    display: 'inline-flex',
    color: 'textSubtle',
    transition: 'transform 0.16s ease',
    'details[open] > summary > &': { transform: 'rotate(90deg)' },
});

const titleText = css({
    minW: 0,
    fontSize: '15px',
    fontWeight: '800',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const metaText = css({
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3',
    fontSize: '12px',
    color: 'textMuted',
});

const countText = css({
    flexShrink: 0,
    fontSize: '13px',
    fontWeight: '700',
    color: 'textSubtle',
    fontVariantNumeric: 'tabular-nums',
});

const body = css({ display: 'flex', flexDirection: 'column', gap: '3', pt: '2', pb: '1' });
