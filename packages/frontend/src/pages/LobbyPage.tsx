import { useSocket } from '@ubichill/sdk/react';
import { useNavigate } from 'react-router-dom';
import { Lobby } from '@/components/lobby';
import { signOut, useSession } from '@/lib/auth-client';
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ color: '#495057', fontSize: '14px' }}>{userName}</span>
                    <button
                        type="button"
                        onClick={handleLogout}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: 'transparent',
                            color: '#868e96',
                            border: '1px solid #dee2e6',
                            borderRadius: '6px',
                            fontSize: '13px',
                            cursor: 'pointer',
                        }}
                    >
                        ログアウト
                    </button>
                </div>
            </div>

            <Lobby userName={userName} onJoinInstance={handleJoinInstance} />
        </main>
    );
}
