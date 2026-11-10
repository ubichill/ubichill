import { EmojiText } from '@/components/ui/EmojiText';
import { css, cva } from '@/styled-system/css';
import type { FriendCard } from './friendPresence';
import { UserIdentity } from './UserIdentity';
import { useOpenUser } from './useOpenUser';

/** フレンド 1 人のカード（顔・名前・2 行目の一言）。押すとプロフィール。オンラインなら顔の右下に点。 */
export function FriendTile({ user, detail, online }: FriendCard) {
    const openUser = useOpenUser();
    return (
        <button type="button" className={tile({ online })} onClick={() => openUser(user)}>
            <UserIdentity
                user={user}
                online={online}
                sub={detail ? <EmojiText text={detail} emojis={user.emojis} /> : null}
            />
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
