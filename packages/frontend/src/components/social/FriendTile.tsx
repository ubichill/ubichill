import { EmojiText } from '@/components/ui/EmojiText';
import { css, cva } from '@/styled-system/css';
import type { FriendCard } from './friendPresence';
import { UserAvatar } from './UserAvatar';
import { useOpenUser } from './useOpenUser';

/** フレンド 1 人のカード（顔・名前・2 行目の一言）。押すとプロフィール。オンラインなら顔の右下に点。 */
export function FriendTile({ user, detail, online }: FriendCard) {
    const openUser = useOpenUser();
    return (
        <button type="button" className={tile({ online })} onClick={() => openUser(user)}>
            <span className={css({ position: 'relative', display: 'inline-flex', flexShrink: 0 })}>
                <UserAvatar user={user} />
                {online && <span className={onlineDot} aria-hidden="true" />}
            </span>
            <span className={css({ display: 'flex', flexDirection: 'column', minW: 0 })}>
                <span className={name}>
                    <EmojiText text={user.name} emojis={user.emojis} />
                </span>
                {detail && (
                    <span className={detailText}>
                        <EmojiText text={detail} emojis={user.emojis} />
                    </span>
                )}
            </span>
        </button>
    );
}

/** フレンドのカードを幅に合わせて並べる。 */
export function FriendGrid({ cards }: { cards: readonly FriendCard[] }) {
    if (cards.length === 0) return null;
    return (
        <div className={grid}>
            {cards.map((card) => (
                <FriendTile key={card.user.id} {...card} />
            ))}
        </div>
    );
}

const grid = css({
    display: 'grid',
    // スマホの幅でも 2 列に並ぶように、狭い画面では最小幅を詰める
    gridTemplateColumns: { base: 'repeat(auto-fill, minmax(148px, 1fr))', md: 'repeat(auto-fill, minmax(180px, 1fr))' },
    alignContent: 'start',
    gap: '2',
});

const tile = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '2.5',
        minW: 0,
        minH: '60px',
        px: '2.5',
        py: '2',
        bg: 'surface',
        border: 'none',
        borderRadius: '10px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _hover: { bg: 'surfaceHover' },
    },
    variants: {
        online: { true: {}, false: { opacity: 0.6, _hover: { opacity: 1 } } },
    },
});

const onlineDot = css({
    position: 'absolute',
    right: '-1px',
    bottom: '-1px',
    w: '12px',
    h: '12px',
    borderRadius: 'full',
    bg: 'hudStatusOn',
    border: '2px solid',
    borderColor: 'surface',
});

const name = css({
    fontSize: '14px',
    fontWeight: '700',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const detailText = css({
    fontSize: '12px',
    color: 'textMuted',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
