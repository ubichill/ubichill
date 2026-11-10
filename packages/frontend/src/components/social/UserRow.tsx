import type { Friendship, RemoteRelation, UserSummary } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { FriendButton } from './FriendButton';
import { UserIdentity } from './UserIdentity';
import { useOpenUser } from './useOpenUser';

/** ユーザー 1 人の行（押すとプロフィール、右にフレンドの操作）。 */
export function UserRow({
    user,
    friendship,
    onChange,
}: {
    user: UserSummary & RemoteRelation;
    friendship: Friendship;
    onChange: (next: Friendship) => void;
}) {
    const openUser = useOpenUser();
    return (
        <li
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '3',
                px: '2',
                py: '1.5',
                borderRadius: '10px',
                transition: 'background-color 0.16s ease',
                _hover: { bg: 'surfaceHover' },
            })}
        >
            <button
                type="button"
                onClick={() => openUser(user)}
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3',
                    flex: 1,
                    minWidth: 0,
                    bg: 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    p: 0,
                })}
            >
                <UserIdentity user={user} sub={`@${user.handle}`} />
            </button>
            {friendship !== 'self' && (
                <FriendButton user={user} friendship={friendship} relation={user} onChange={onChange} />
            )}
        </li>
    );
}
