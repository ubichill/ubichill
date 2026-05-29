import { useNavigate } from 'react-router-dom';
import { HudTabs } from '@/components/hud/HudTabs';
import { type AccountMenuItem, LobbyAccountMenu } from '@/components/lobby/LobbyAccountMenu';
import { signOut, useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import * as styles from '@/styles/styles';

export function LobbyPage() {
    const navigate = useNavigate();
    const { data: session } = useSession();

    const userName = session?.user?.name ?? '';

    const handleJoinInstance = (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => {
        navigate(`/instance/${instanceId}`, { state: { worldId, worldData } });
    };

    const handleLogout = async () => {
        await signOut();
        navigate('/auth');
    };

    const accountMenuItems: AccountMenuItem[] = [
        {
            id: 'logout',
            label: 'ログアウト',
            onSelect: handleLogout,
            variant: 'danger',
            icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                </svg>
            ),
        },
    ];

    return (
        <main
            className={styles.mainContainer}
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                overflow: 'hidden',
            }}
        >
            <div
                className={css({
                    position: 'fixed',
                    top: '12px',
                    left: '12px',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    px: '12px',
                    py: '7px',
                    bg: 'glassBg',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: 'full',
                    boxShadow: 'card',
                    color: 'text',
                })}
            >
                <img
                    src="/icon.png"
                    alt=""
                    className={css({
                        width: '24px',
                        height: '24px',
                        borderRadius: '7px',
                        objectFit: 'cover',
                        flexShrink: 0,
                    })}
                />
                <span className={css({ fontSize: '15px', fontWeight: '700', lineHeight: 1 })}>Ubichill</span>
            </div>

            <LobbyAccountMenu userName={userName} items={accountMenuItems} />

            <div className={css({ h: { base: '14', md: '12' }, flexShrink: 0 })} />

            <HudTabs onJoinInstance={handleJoinInstance} initialTab="home" />
        </main>
    );
}
