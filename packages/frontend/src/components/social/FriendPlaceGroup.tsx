import { ACCESS_TYPE_LABELS, type Instance } from '@ubichill/shared';
import { HudIcon } from '@/components/hud/HudIcon';
import { css } from '@/styled-system/css';
import { accessIcon } from './accessIcon';
import { FriendGroup } from './FriendGroup';
import { FriendGrid } from './FriendTile';
import { type FriendPlace, placeFriendCards } from './friendPresence';

/**
 * フレンドのいる部屋 1 つ。見出し（ワールド名・公開範囲・フレンドの数）の下に、部屋のカードとそこにいるフレンドを並べる。
 * here は自分がいる部屋（入る操作を出さず「ここにいます」の印）。招待が要る部屋（canJoin が false）は「入る」の代わりに「リクエスト」。
 */
export function FriendPlaceGroup({
    place,
    here,
    onJoin,
    onRequest,
    requested,
}: {
    place: FriendPlace;
    here?: boolean;
    onJoin?: () => void;
    onRequest?: () => void;
    requested?: boolean;
}) {
    const { instance, friends } = place;
    return (
        <FriendGroup
            title={instance.world.displayName}
            count={friends.length}
            meta={
                <>
                    <span className={metaItem}>
                        <HudIcon name={accessIcon(instance.access.type)} size={14} />
                        {ACCESS_TYPE_LABELS[instance.access.type]}
                    </span>
                    {instance.remote && (
                        <span className={metaItem} title="部屋のサーバー">
                            <HudIcon name="globe" size={14} />
                            {instance.remote.domain}
                        </span>
                    )}
                </>
            }
        >
            <div className={layout}>
                <PlaceTile
                    instance={instance}
                    friendCount={friends.length}
                    here={here}
                    onJoin={onJoin}
                    onRequest={onRequest}
                    requested={requested}
                />
                <FriendGrid cards={placeFriendCards(friends)} />
            </div>
        </FriendGroup>
    );
}

function PlaceTile({
    instance,
    friendCount,
    here,
    onJoin,
    onRequest,
    requested,
}: {
    instance: Instance;
    friendCount: number;
    here?: boolean;
    onJoin?: () => void;
    onRequest?: () => void;
    requested?: boolean;
}) {
    const needsInvite = instance.canJoin === false;
    const { world, stats } = instance;
    return (
        <article className={tile} data-here={here || undefined}>
            <div className={thumb}>
                {world.thumbnail ? (
                    <img src={world.thumbnail} alt="" className={thumbImage} />
                ) : (
                    <HudIcon name="globe" size={26} />
                )}
                {here && <span className={hereBadge}>ここにいます</span>}
            </div>
            <div className={info}>
                <h3 className={worldName}>{world.displayName}</h3>
                <p className={counts}>
                    <span className={metaItem} title="いる人 / 定員">
                        <HudIcon name="user" size={14} />
                        {stats.currentUsers}/{stats.maxUsers}
                    </span>
                    <span className={metaItem} title="フレンド">
                        <HudIcon name="users" size={14} />
                        {friendCount}
                    </span>
                </p>
                {!here && !needsInvite && onJoin && (
                    <button type="button" className={joinButton} onClick={onJoin}>
                        <HudIcon name="enter" size={16} />
                        入る
                    </button>
                )}
                {!here && needsInvite && onRequest && (
                    <button type="button" className={joinButton} onClick={onRequest} disabled={requested}>
                        <HudIcon name="userPlus" size={16} />
                        {requested ? 'リクエスト済み' : 'リクエスト'}
                    </button>
                )}
            </div>
        </article>
    );
}

/** 広い画面は部屋のカードを左に、フレンドを右に。狭い画面は上下に。 */
const layout = css({
    display: 'grid',
    gridTemplateColumns: { base: '1fr', lg: '200px 1fr' },
    alignItems: 'start',
    gap: '3',
});

/** 狭い画面ではサムネイルを左に置いた横長、広い画面では縦長。 */
const tile = css({
    display: 'flex',
    flexDirection: { base: 'row', lg: 'column' },
    alignItems: { base: 'center', lg: 'stretch' },
    gap: { base: '3', lg: '2' },
    p: '2',
    bg: 'surface',
    borderRadius: '12px',
    '&[data-here]': { bg: 'surfaceAccent' },
});

const thumb = css({
    position: 'relative',
    flexShrink: 0,
    w: { base: '112px', lg: 'full' },
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
    top: '1.5',
    px: '1.5',
    py: '0.5',
    borderRadius: '4px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '10px',
    fontWeight: '700',
});

const info = css({
    flex: 1,
    minW: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5',
    px: { lg: '1' },
    pb: { lg: '1' },
});

const worldName = css({
    fontSize: '14px',
    fontWeight: '800',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const counts = css({ display: 'flex', gap: '3', fontSize: '12px', color: 'textMuted' });

const metaItem = css({ display: 'inline-flex', alignItems: 'center', gap: '1', whiteSpace: 'nowrap' });

const joinButton = css({
    alignSelf: { base: 'flex-start', lg: 'stretch' },
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5',
    px: '3',
    py: '1.5',
    border: 'none',
    borderRadius: '8px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'primaryHover' },
    _disabled: { opacity: 0.5, cursor: 'default', _hover: { bg: 'primary' } },
});
