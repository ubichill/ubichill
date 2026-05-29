import { useEffect, useState } from 'react';
import { InstanceCard } from '@/components/lobby/InstanceCard';
import { Lobby } from '@/components/lobby/Lobby';
import { useInstances } from '@/components/lobby/useInstances';
import { UserProfileView } from '@/components/profile';
import { css } from '@/styled-system/css';

export type HudTabId = 'home' | 'worlds' | 'friends' | 'profile';

type JoinInstanceHandler = (
    instanceId: string,
    worldId: string,
    worldData?: { thumbnail?: string; displayName?: string },
) => void;

const TABS: { id: HudTabId; label: string; icon: React.ReactNode }[] = [
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
    {
        id: 'profile',
        label: 'マイページ',
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
        ),
    },
];

/** 各タブのスクロール領域。オーバーレイ表示時にカード内クリックで閉じないよう伝播を止める。 */
const tabPanel = css({
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
});

const cardBase = {
    bg: 'surfaceAccent',
    borderRadius: '24px',
    p: { base: '4', md: '6' },
    boxShadow: 'card',
};

const cardStyle = css(cardBase);

const sectionHeading = css({ fontSize: 'xl', fontWeight: 'bold', mb: '4', color: 'text' });

function HomeTab({ onJoinInstance }: { onJoinInstance: JoinInstanceHandler }) {
    const { instances, loading, error, refreshInstances } = useInstances();

    useEffect(() => {
        void refreshInstances();
    }, [refreshInstances]);

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>オンラインのフレンド</h2>
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

            <div className={css(cardBase, { flex: 1 })}>
                <h2 className={sectionHeading}>アクティブなインスタンス</h2>
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
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>フレンド一覧</h2>
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

function ProfileTab({ onNavigate }: { onNavigate?: () => void }) {
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <UserProfileView onNavigate={onNavigate} />
            </div>
        </div>
    );
}

interface HudTabsProps {
    onJoinInstance: JoinInstanceHandler;
    /** インスタンス内オーバーレイ表示時、現在参加中のインスタンスID */
    currentInstanceId?: string;
    /** 初期表示タブ。省略時は 'home' */
    initialTab?: HudTabId;
    /** タブ内から画面遷移する直前に呼ばれる（オーバーレイを閉じる用） */
    onNavigate?: () => void;
}

/**
 * ロビーとインスタンス内オーバーレイで共通利用する HUD ナビゲーション。
 * ホーム / ワールド / フレンド / マイページを遷移なしのタブで切り替える。
 */
export function HudTabs({ onJoinInstance, currentInstanceId, initialTab = 'home', onNavigate }: HudTabsProps) {
    const [activeTab, setActiveTab] = useState<HudTabId>(initialTab);

    return (
        <>
            <div className={css({ flex: 1, minH: 0, overflow: 'hidden', pb: '100px' })}>
                {activeTab === 'home' && <HomeTab onJoinInstance={onJoinInstance} />}
                {activeTab === 'worlds' && (
                    <Lobby onJoinInstance={onJoinInstance} mode="modal" currentInstanceId={currentInstanceId} />
                )}
                {activeTab === 'friends' && <FriendsTab />}
                {activeTab === 'profile' && <ProfileTab onNavigate={onNavigate} />}
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
                onClick={(e) => e.stopPropagation()}
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
        </>
    );
}
