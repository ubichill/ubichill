import { useState } from 'react';
import { css } from '@/styled-system/css';
import { FriendsTab } from './tabs/FriendsTab';
import { HomeTab } from './tabs/HomeTab';
import { InstanceTab } from './tabs/InstanceTab';
import { ProfileTab } from './tabs/ProfileTab';
import type { JoinInstanceHandler } from './tabs/shared';
import { WorldsTab } from './tabs/WorldsTab';

export type HudTabId = 'instance' | 'home' | 'worlds' | 'friends' | 'profile';

interface TabDef {
    id: HudTabId;
    label: string;
    icon: React.ReactNode;
    /** インスタンス内（currentInstanceId あり）でのみ表示するタブ */
    instanceOnly?: boolean;
}

const TABS: TabDef[] = [
    {
        id: 'instance',
        label: '現在地',
        instanceOnly: true,
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
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
                <circle cx="12" cy="10" r="3" />
            </svg>
        ),
    },
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
 * 現在地 / ホーム / ワールド / フレンド / マイページを遷移なしのタブで切り替える。
 * タブバーは PC では上部、スマホでは下部に表示する。
 */
export function HudTabs({ onJoinInstance, currentInstanceId, initialTab = 'home', onNavigate }: HudTabsProps) {
    const [activeTab, setActiveTab] = useState<HudTabId>(initialTab);

    const visibleTabs = TABS.filter((tab) => !tab.instanceOnly || currentInstanceId);

    return (
        <>
            <div
                className={css({
                    flex: 1,
                    minH: 0,
                    overflow: 'hidden',
                    pb: { base: '100px', md: '24px' },
                    pt: { base: '0', md: '96px' },
                })}
            >
                {activeTab === 'instance' && currentInstanceId && (
                    <InstanceTab
                        currentInstanceId={currentInstanceId}
                        onJoinInstance={onJoinInstance}
                        onNavigate={onNavigate}
                    />
                )}
                {activeTab === 'home' && (
                    <HomeTab onJoinInstance={onJoinInstance} currentInstanceId={currentInstanceId} />
                )}
                {activeTab === 'worlds' && (
                    <WorldsTab onJoinInstance={onJoinInstance} currentInstanceId={currentInstanceId} />
                )}
                {activeTab === 'friends' && <FriendsTab />}
                {activeTab === 'profile' && <ProfileTab onNavigate={onNavigate} />}
            </div>

            <div
                className={css({
                    position: 'fixed',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 100,
                    width: 'calc(100% - 32px)',
                    maxWidth: '730px',
                    bottom: { base: '20px', md: 'auto' },
                    top: { base: 'auto', md: '16px' },
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
                    {visibleTabs.map((tab) => (
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
