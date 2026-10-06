import type { UserSummary } from '@ubichill/shared';
import { cva } from '@/styled-system/css';

const avatar = cva({
    base: {
        flexShrink: 0,
        borderRadius: 'full',
        bg: 'primarySubtle',
        color: 'primary',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '700',
        overflow: 'hidden',
        objectFit: 'cover',
    },
    variants: {
        size: {
            sm: { width: '32px', height: '32px', fontSize: '13px' },
            md: { width: '40px', height: '40px', fontSize: '16px' },
        },
    },
    defaultVariants: { size: 'md' },
});

/** プロフィール画像（無ければ表示名の頭文字）。 */
export function UserAvatar({
    user,
    size,
}: {
    user: Pick<UserSummary, 'name' | 'profileImageUrl'>;
    size?: 'sm' | 'md';
}) {
    if (user.profileImageUrl) return <img src={user.profileImageUrl} alt="" className={avatar({ size })} />;
    return (
        <span className={avatar({ size })} aria-hidden>
            {Array.from(user.name)[0] ?? '?'}
        </span>
    );
}
