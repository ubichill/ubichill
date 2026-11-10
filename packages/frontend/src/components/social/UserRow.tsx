import type { Friendship, RemoteRelation, UserSummary } from '@ubichill/shared';
import { EmojiText } from '@/components/ui/EmojiText';
import { css } from '@/styled-system/css';
import { FriendButton } from './FriendButton';
import { UserAvatar } from './UserAvatar';
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
                        <EmojiText text={user.name} emojis={user.emojis} />
                    </span>
                    <span className={css({ display: 'block', fontSize: '12px', color: 'textMuted', lineClamp: 1 })}>
                        @{user.handle}
                    </span>
                </span>
            </button>
            {friendship !== 'self' && (
                <FriendButton user={user} friendship={friendship} relation={user} onChange={onChange} />
            )}
        </li>
    );
}
