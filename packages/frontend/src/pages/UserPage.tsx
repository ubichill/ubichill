import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { UserProfileView } from '@/components/profile';
import { fetchUserByHandle } from '@/lib/socialApi';
import { css } from '@/styled-system/css';

/** ユーザーページ（/user/:userId と /@ID）。 */
export function UserPage() {
    const navigate = useNavigate();
    const { userId: routeUserId, at } = useParams<{ userId?: string; at?: string }>();
    const handle = at?.startsWith('@') ? at.slice(1) : undefined;
    const [resolved, setResolved] = useState<{ handle: string; userId: string | null } | null>(null);

    useEffect(() => {
        if (!handle) return;
        const ctrl = { cancelled: false };
        fetchUserByHandle(handle)
            .then((u) => !ctrl.cancelled && setResolved({ handle, userId: u.id }))
            .catch(() => !ctrl.cancelled && setResolved({ handle, userId: null }));
        return () => {
            ctrl.cancelled = true;
        };
    }, [handle]);

    // /:at は /@ID だけ。それ以外の 1 段のパスはロビーへ
    if (at !== undefined && !handle) return <Navigate to="/" replace />;
    const handleState = handle && resolved?.handle === handle ? resolved : null;
    const userId = handle ? handleState?.userId : routeUserId;

    return (
        <div
            className={css({
                width: 'full',
                maxW: '4xl',
                mx: 'auto',
                p: { base: '4', md: '6' },
                minH: '100vh',
            })}
        >
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2',
                    mb: '4',
                })}
            >
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className={css({
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        bg: 'surface',
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '10px',
                        color: 'textMuted',
                        fontSize: '13px',
                        cursor: 'pointer',
                        _hover: { borderColor: 'borderStrong' },
                    })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                    ロビーへ
                </button>
            </div>

            {handle && !handleState && <p className={css({ color: 'textMuted' })}>読み込み中...</p>}
            {handle && handleState && !handleState.userId && (
                <p className={css({ color: 'errorText' })}>@{handle} というユーザーは見つかりませんでした。</p>
            )}
            {(!handle || handleState?.userId) && (
                <UserProfileView
                    userId={userId ?? undefined}
                    onEditProfile={() => navigate('/', { state: { hudTab: 'settings' } })}
                />
            )}
        </div>
    );
}
