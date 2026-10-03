import type { Friendship, UserSummary } from '@ubichill/shared';
import { useNavigate } from 'react-router';
import { userPagePath } from '@/lib/userPath';
import { css } from '@/styled-system/css';
import { FriendButton } from './FriendButton';
import { UserAvatar } from './UserAvatar';

/** ユーザー 1 人の行（クリックでユーザーページ、右にフレンドの操作）。 */
export function UserRow({
    user,
    friendship,
    onChange,
}: {
    user: UserSummary;
    friendship: Friendship;
    onChange: (next: Friendship) => void;
}) {
    const navigate = useNavigate();
    return (
        <li
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '3',
                px: '3',
                py: '2',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '12px',
            })}
        >
            <button
                type="button"
                onClick={() => navigate(userPagePath(user))}
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
                <UserAvatar user={user} />
                <span className={css({ minWidth: 0 })}>
                    <span
                        className={css({
                            display: 'block',
                            fontSize: '14px',
                            fontWeight: '600',
                            color: 'text',
                            lineClamp: 1,
                        })}
                    >
                        {user.name}
                    </span>
                    <span className={css({ display: 'block', fontSize: '12px', color: 'textMuted', lineClamp: 1 })}>
                        {user.handle ? `@${user.handle}` : 'ID 未設定'}
                    </span>
                </span>
            </button>
            {friendship !== 'self' && <FriendButton user={user} friendship={friendship} onChange={onChange} />}
        </li>
    );
}
