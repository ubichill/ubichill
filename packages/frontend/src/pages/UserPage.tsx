import { useNavigate, useParams } from 'react-router-dom';
import { UserProfileView } from '@/components/profile';
import { css } from '@/styled-system/css';

export function UserPage() {
    const navigate = useNavigate();
    const { userId: routeUserId } = useParams<{ userId?: string }>();

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

            <UserProfileView userId={routeUserId} />
        </div>
    );
}
