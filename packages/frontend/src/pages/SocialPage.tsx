import { useNavigate } from 'react-router';
import { SocialPanel } from '@/components/social';
import { css } from '@/styled-system/css';

/** ソーシャルページ（/social）: フレンドの現在地・ユーザー検索・フレンドと申請。 */
export function SocialPage() {
    const navigate = useNavigate();
    return (
        <div className={css({ width: 'full', maxW: '5xl', mx: 'auto', p: { base: '4', md: '6' }, minH: '100vh' })}>
            <button
                type="button"
                onClick={() => navigate('/')}
                className={css({
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    mb: '4',
                    padding: '8px 14px',
                    bg: 'surface',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '10px',
                    color: 'textMuted',
                    fontSize: '13px',
                    cursor: 'pointer',
                })}
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                >
                    <path d="M15 18l-6-6 6-6" />
                </svg>
                ロビーへ
            </button>
            <SocialPanel
                onJoin={(instance) =>
                    navigate(`/instance/${instance.id}`, {
                        state: {
                            worldId: instance.world.id,
                            worldData: { thumbnail: instance.world.thumbnail, displayName: instance.world.displayName },
                        },
                    })
                }
            />
        </div>
    );
}
