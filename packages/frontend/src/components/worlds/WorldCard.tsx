import { type WorldListItem, worldSourceLabel } from '@ubichill/shared';
import { HudIcon } from '@/components/hud/HudIcon';
import { css } from '@/styled-system/css';
import { AuthorAccountLabel } from './AuthorAccountLabel';
import { FavoriteButton } from './FavoriteButton';
import { WorldIdentityBadge } from './WorldIdentityBadge';

interface WorldCardProps {
    world: WorldListItem;
    onSelect: (world: WorldListItem) => void;
}

/** ワールド 1 つ（サムネイル・名前・作者・定員・由来）。説明と版は詳細で見る。 */
export function WorldCard({ world, onSelect }: WorldCardProps) {
    return (
        <div className={css({ position: 'relative', width: '100%', minW: 0 })}>
            {/* カード（button）の外側に置く。button の入れ子は不正なため兄弟として重ねる。 */}
            <div className={css({ position: 'absolute', top: '2', right: '2', zIndex: 1 })}>
                <FavoriteButton worldRef={world.url} />
            </div>
            <button type="button" onClick={() => onSelect(world)} className={card}>
                <span className={thumb}>
                    {world.thumbnail ? (
                        <img src={world.thumbnail} alt="" className={thumbImage} />
                    ) : (
                        <HudIcon name="globe" size={30} />
                    )}
                </span>
                <span className={body}>
                    <span className={title}>{world.displayName}</span>
                    {world.identity?.status === 'verified' && world.identity.author && (
                        <AuthorAccountLabel author={world.identity.author} />
                    )}
                    <span className={meta}>
                        <span className={metaItem} title="定員">
                            <HudIcon name="user" size={13} />
                            {world.capacity.max}
                        </span>
                        <WorldIdentityBadge identity={world.identity} />
                        {/* どのサーバー/由来のワールドか（このインスタンス / GitHub / 外部ホスト等） */}
                        <span className={source} title={world.source.originInstance ?? world.source.url}>
                            {worldSourceLabel(world.source)}
                        </span>
                    </span>
                </span>
            </button>
        </div>
    );
}

const card = css({
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    minW: 0,
    p: '0',
    bg: 'surface',
    border: 'none',
    borderRadius: '12px',
    overflow: 'hidden',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'surfaceHover' },
});

const thumb = css({
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: 'full',
    aspectRatio: '16 / 9',
    bg: 'secondary',
    color: 'textSubtle',
});

const thumbImage = css({ position: 'absolute', inset: 0, w: 'full', h: 'full', objectFit: 'cover' });

const body = css({ display: 'flex', flexDirection: 'column', gap: '1', px: '3', pt: '2.5', pb: '3', minW: 0 });

const title = css({
    fontSize: '15px',
    fontWeight: '700',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const meta = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    mt: '0.5',
    fontSize: '12px',
    color: 'textSubtle',
    minW: 0,
});

const metaItem = css({ display: 'inline-flex', alignItems: 'center', gap: '1', whiteSpace: 'nowrap' });

const source = css({
    ml: 'auto',
    px: '1.5',
    py: '0.5',
    bg: 'primarySubtle',
    borderRadius: '4px',
    fontSize: '11px',
    color: 'textMuted',
    maxW: '50%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
