import { ACCESS_TYPE_LABELS, type Instance } from '@ubichill/shared';
import type { ReactNode } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { css } from '@/styled-system/css';
import { accessIcon } from './accessIcon';

/**
 * 部屋 1 つ（サムネイル・ワールド名・公開範囲・人数）と、そこにいるフレンド。
 * here は自分がいる部屋（入る操作を出さず「ここにいます」の印）。
 */
export function PlaceCard({
    instance,
    here,
    onJoin,
    children,
}: {
    instance: Instance;
    here?: boolean;
    onJoin?: () => void;
    children?: ReactNode;
}) {
    const { world, stats, access } = instance;
    return (
        <article className={card} data-here={here || undefined}>
            <div className={head}>
                <div className={thumb}>
                    {world.thumbnail ? (
                        <img src={world.thumbnail} alt="" className={thumbImage} />
                    ) : (
                        <HudIcon name="globe" size={26} />
                    )}
                    {here && <span className={hereBadge}>ここにいます</span>}
                </div>
                <div className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column', gap: '1' })}>
                    <h3 className={title}>{world.displayName}</h3>
                    <p className={meta}>
                        <span className={metaItem}>
                            <HudIcon name={accessIcon(access.type)} size={14} />
                            {ACCESS_TYPE_LABELS[access.type]}
                        </span>
                        <span className={metaItem} title="いる人 / 定員">
                            <HudIcon name="user" size={14} />
                            {stats.currentUsers}/{stats.maxUsers}
                        </span>
                    </p>
                </div>
                {!here && onJoin && (
                    <button type="button" className={joinButton} onClick={onJoin}>
                        <HudIcon name="enter" size={16} />
                        入る
                    </button>
                )}
            </div>
            {children}
        </article>
    );
}

const card = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '2',
    p: '3',
    bg: 'surface',
    borderRadius: '12px',
    '&[data-here]': { bg: 'surfaceAccent' },
});

const head = css({ display: 'flex', alignItems: 'center', gap: '3', minW: 0 });

const thumb = css({
    position: 'relative',
    flexShrink: 0,
    w: { base: '96px', md: '132px' },
    aspectRatio: '16 / 9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    overflow: 'hidden',
    bg: 'secondary',
    color: 'textSubtle',
});

const thumbImage = css({ position: 'absolute', inset: 0, w: 'full', h: 'full', objectFit: 'cover' });

const hereBadge = css({
    position: 'absolute',
    left: '1.5',
    bottom: '1.5',
    px: '1.5',
    py: '0.5',
    borderRadius: '4px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '10px',
    fontWeight: '700',
});

const title = css({
    fontSize: '15px',
    fontWeight: '800',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const meta = css({ display: 'flex', flexWrap: 'wrap', gap: '3', fontSize: '12px', color: 'textMuted' });

const metaItem = css({ display: 'inline-flex', alignItems: 'center', gap: '1', whiteSpace: 'nowrap' });

const joinButton = css({
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    px: '3.5',
    py: '2',
    border: 'none',
    borderRadius: '8px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'primaryHover' },
});
