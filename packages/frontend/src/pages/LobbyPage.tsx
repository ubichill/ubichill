import { useSocket } from '@ubichill/sdk/react';
import { useNavigate } from 'react-router-dom';
import { Lobby } from '@/components/lobby';
import { signOut, useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import * as styles from '@/styles/styles';

export function LobbyPage() {
    const navigate = useNavigate();
    const { data: session } = useSession();
    const { isConnected, error } = useSocket();

    const userName = session?.user?.name ?? '';

    const handleJoinInstance = (instanceId: string, worldId: string) => {
        navigate(`/instance/${instanceId}`, { state: { worldId } });
    };

    const handleLogout = async () => {
        await signOut();
        navigate('/auth');
    };

    return (
        <main className={styles.mainContainer}>
            <div className={styles.headerContainer}>
                <p className={styles.statusBar}>
                    ステータス: {isConnected ? '接続済み' : '切断'}
                    {error && <span className={styles.errorText}>{error}</span>}
                </p>
                <div className={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                    <span className={css({ color: 'textMuted', fontSize: 'sm' })}>{userName}</span>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className={css({
                            px: '4',
                            py: '2',
                            backgroundColor: 'transparent',
                            color: 'textSubtle',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: 'md',
                            fontSize: 'xs',
                            cursor: 'pointer',
                            _hover: { borderColor: 'borderStrong', color: 'textMuted' },
                        })}
                    >
                        ログアウト
                    </button>
                </div>
            </div>

            <Lobby onJoinInstance={handleJoinInstance} />
        </main>
    );
}
