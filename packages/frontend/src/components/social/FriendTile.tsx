import type { UserSummary } from '@ubichill/shared';
import { css, cva } from '@/styled-system/css';
import { UserAvatar } from './UserAvatar';
import { useOpenUser } from './useOpenUser';

/** フレンド 1 人（顔・名前・いる場所）。押すとプロフィール。presence はアイコンの右下の点の色。 */
export function FriendTile({
    user,
    status,
    presence,
}: {
    user: UserSummary;
    status?: string;
    presence: 'online' | 'offline';
}) {
    const openUser = useOpenUser();
    return (
        <button type="button" className={tile({ presence })} onClick={() => openUser(user)}>
            <span className={css({ position: 'relative', display: 'inline-flex', flexShrink: 0 })}>
                <UserAvatar user={user} />
                {presence === 'online' && <span className={onlineDot} aria-hidden="true" />}
            </span>
            <span className={css({ display: 'flex', flexDirection: 'column', minW: 0 })}>
                <span className={name}>{user.name}</span>
                {status && <span className={statusText}>{status}</span>}
            </span>
        </button>
    );
}

const tile = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '2.5',
        minW: 0,
        px: '2',
        py: '1.5',
        bg: 'transparent',
        border: 'none',
        borderRadius: '10px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _hover: { bg: 'surfaceHover' },
    },
    variants: {
        presence: { online: {}, offline: { opacity: 0.6, _hover: { opacity: 1 } } },
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
    borderColor: 'background',
});

const name = css({
    fontSize: '14px',
    fontWeight: '700',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const statusText = css({
    fontSize: '12px',
    color: 'textMuted',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
