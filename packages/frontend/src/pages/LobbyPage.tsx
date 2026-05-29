import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lobby } from '@/components/lobby';
import { InstanceCard } from '@/components/lobby/InstanceCard';
import { type AccountMenuItem, LobbyAccountMenu } from '@/components/lobby/LobbyAccountMenu';
import { useInstances } from '@/components/lobby/useInstances';
import { signOut, useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import * as styles from '@/styles/styles';

type TabId = 'home' | 'worlds' | 'friends';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
        id: 'home',
        label: 'ホーム',
        icon: (
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
        ),
    },
    {
        id: 'worlds',
        label: 'ワールド',
        icon: (
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                <path d="M2 12h20" />
            </svg>
        ),
    },
    {
        id: 'friends',
        label: 'フレンド',
        icon: (
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
    },
];

function HomeTab({
    onJoinInstance,
}: {
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
}) {
    const { instances, loading, error, refreshInstances } = useInstances();

    useEffect(() => {
        void refreshInstances();
    }, [refreshInstances]);

    return (
        <div
            className={css({
                width: 'full',
                maxWidth: '730px',
                mx: 'auto',
                px: { base: '2', md: '0' },
                display: 'flex',
                flexDirection: 'column',
                gap: '6',
                h: 'full',
                overflowY: 'auto',
                pb: '20px',
            })}
        >
            <div
                className={css({
                    bg: 'surfaceAccent',
                    borderRadius: '24px',
                    p: { base: '4', md: '6' },
                    boxShadow: 'card',
                })}
            >
                <h2 className={css({ fontSize: 'xl', fontWeight: 'bold', mb: '4', color: 'text' })}>
                    オンラインのフレンド
                </h2>
                <div
                    className={css({
                        p: '6',
                        bg: 'secondary',
                        borderRadius: '12px',
                        textAlign: 'center',
                        color: 'textMuted',
                        fontSize: '15px',
                    })}
                >
                    Coming Soon...
                </div>
            </div>

            <div
                className={css({
                    bg: 'surfaceAccent',
                    borderRadius: '24px',
                    p: { base: '4', md: '6' },
                    boxShadow: 'card',
                    flex: 1,
                })}
            >
                <h2 className={css({ fontSize: 'xl', fontWeight: 'bold', mb: '4', color: 'text' })}>
                    アクティブなインスタンス
                </h2>
                {loading && instances.length === 0 ? (
                    <div className={css({ textAlign: 'center', p: '4', color: 'textMuted' })}>読み込み中...</div>
                ) : error ? (
                    <div className={css({ p: '4', bg: 'errorBg', color: 'errorText', borderRadius: '8px' })}>
                        {error}
                    </div>
                ) : instances.length === 0 ? (
                    <div
                        className={css({
                            textAlign: 'center',
                            p: '6',
                            bg: 'secondary',
                            borderRadius: '12px',
                            color: 'textMuted',
                        })}
                    >
                        アクティブなインスタンスはありません
                    </div>
                ) : (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                        {instances.map((instance) => (
                            <InstanceCard
                                key={instance.id}
                                instance={instance}
                                onJoin={(id) =>
                                    onJoinInstance(id, instance.world.id, {
                                        thumbnail: instance.world.thumbnail,
                                        displayName: instance.world.displayName,
                                    })
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function FriendsTab() {
    return (
        <div
            className={css({
                width: 'full',
                maxWidth: '730px',
                mx: 'auto',
                px: { base: '2', md: '0' },
                display: 'flex',
                flexDirection: 'column',
                gap: '6',
                h: 'full',
                overflowY: 'auto',
                pb: '20px',
            })}
        >
            <div
                className={css({
                    bg: 'surfaceAccent',
                    borderRadius: '24px',
                    p: { base: '4', md: '6' },
                    boxShadow: 'card',
                })}
            >
                <h2 className={css({ fontSize: 'xl', fontWeight: 'bold', mb: '4', color: 'text' })}>フレンド一覧</h2>
                <div
                    className={css({
                        p: '8',
                        bg: 'secondary',
                        borderRadius: '12px',
                        textAlign: 'center',
                        color: 'textMuted',
                        fontSize: '15px',
                    })}
                >
                    Coming Soon...
                </div>
            </div>
        </div>
    );
}

export function LobbyPage() {
    const navigate = useNavigate();
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState<TabId>('home');

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
            id: 'profile',
            label: 'マイページ',
            onSelect: () => navigate('/user/me'),
            icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                </svg>
            ),
        },
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
                paddingBottom: '100px',
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

            <div className={css({ flex: 1, minH: 0, overflow: 'hidden' })}>
                {activeTab === 'home' && <HomeTab onJoinInstance={handleJoinInstance} />}
                {activeTab === 'worlds' && <Lobby onJoinInstance={handleJoinInstance} />}
                {activeTab === 'friends' && <FriendsTab />}
            </div>

            <div
                className={css({
                    position: 'fixed',
                    bottom: { base: '20px', md: '32px' },
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 100,
                    width: 'calc(100% - 32px)',
                    maxWidth: '730px',
                })}
            >
                <div
                    className={css({
                        display: 'flex',
                        bg: 'primary',
                        borderRadius: '24px',
                        boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
                        overflow: 'hidden',
                        p: '2',
                        gap: '2',
                    })}
                >
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={css({
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                py: '8px',
                                borderRadius: '18px',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                bg: 'transparent',
                                color: activeTab === tab.id ? 'primaryHighlight' : 'hudTextMuted',
                                _hover: {
                                    color: activeTab === tab.id ? 'primaryHighlight' : 'hudText',
                                    bg: 'rgba(255, 255, 255, 0.05)',
                                },
                            })}
                        >
                            {tab.icon}
                            <span className={css({ fontSize: '11px', fontWeight: '700' })}>{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </main>
    );
}
