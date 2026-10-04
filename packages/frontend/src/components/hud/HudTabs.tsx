import { useState } from 'react';
import { useNotifications } from '@/components/notifications';
import { css } from '@/styled-system/css';
import { HomeTab } from './tabs/HomeTab';
import { InstanceTab } from './tabs/InstanceTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { ProfileTab } from './tabs/ProfileTab';
import { SettingsTab } from './tabs/SettingsTab';
import { SocialTab } from './tabs/SocialTab';
import type { JoinInstanceHandler } from './tabs/shared';
import { WorldsTab } from './tabs/WorldsTab';

export type HudTabId = 'instance' | 'home' | 'worlds' | 'social' | 'notifications' | 'profile' | 'settings';

interface TabDef {
    id: HudTabId;
    label: string;
    icon: React.ReactNode;
    /** インスタンス内（currentInstanceId あり）でのみ表示するタブ */
    instanceOnly?: boolean;
    /** タブバーに出さない（ほかの入口から開く） */
    hidden?: boolean;
}

const TABS: TabDef[] = [
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
        id: 'social',
        label: 'ソーシャル',
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
        id: 'notifications',
        label: '通知',
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
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
        ),
    },
    {
        // タブバーには出さない（自分のユーザー名を押すと開く）
        id: 'profile',
        label: 'マイページ',
        hidden: true,
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
    {
        id: 'settings',
        label: '設定',
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
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
    /** ロビーへ戻る操作（インスタンス内のみ。ホーム/現在地タブにボタンを出す） */
    onReturnToLobby?: () => void;
    /** 表示するタブを外から決める（自分のユーザー名からマイページを開くため）。省略時は内部で持つ */
    activeTab?: HudTabId;
    onTabChange?: (tab: HudTabId) => void;
}

/**
 * ロビーとインスタンス内オーバーレイで共通利用する HUD ナビゲーション。
 * 現在地 / ホーム / ワールド / ソーシャル / 通知 / 設定を遷移なしのタブで切り替える（マイページは自分のユーザー名から開く）。
 * タブバーは PC では上部、スマホでは下部に表示する。
 */
export function HudTabs({
    onJoinInstance,
    currentInstanceId,
    initialTab = 'home',
    onNavigate,
    onReturnToLobby,
    activeTab: controlledTab,
    onTabChange,
}: HudTabsProps) {
    const [internalTab, setInternalTab] = useState<HudTabId>(initialTab);
    const activeTab = controlledTab ?? internalTab;
    const setActiveTab = onTabChange ?? setInternalTab;
    const notifications = useNotifications();
    const badges: Partial<Record<HudTabId, number>> = { notifications: notifications.items.length };

    const visibleTabs = TABS.filter((tab) => !tab.hidden && (!tab.instanceOnly || currentInstanceId));

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
                        onNavigate={onNavigate}
                        onReturnToLobby={onReturnToLobby}
                    />
                )}
                {activeTab === 'home' && (
                    <HomeTab
                        onJoinInstance={onJoinInstance}
                        currentInstanceId={currentInstanceId}
                        onReturnToLobby={onReturnToLobby}
                    />
                )}
                {activeTab === 'worlds' && (
                    <WorldsTab onJoinInstance={onJoinInstance} currentInstanceId={currentInstanceId} />
                )}
                {activeTab === 'social' && (
                    <SocialTab
                        currentInstanceId={currentInstanceId}
                        onJoinInstance={onJoinInstance}
                        onFriendshipChange={() => void notifications.reload()}
                    />
                )}
                {activeTab === 'notifications' && (
                    <NotificationsTab notifications={notifications} onNavigate={onNavigate} />
                )}
                {activeTab === 'profile' && <ProfileTab onNavigate={onNavigate} onJoinInstance={onJoinInstance} />}
                {activeTab === 'settings' && <SettingsTab />}
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
                        bg: 'hudPanel',
                        backdropFilter: 'blur(12px)',
                        borderRadius: '24px',
                        boxShadow: 'modal',
                        border: '1px solid',
                        borderColor: 'hudBorder',
                        overflow: 'hidden',
                        p: { base: '1.5', md: '2' },
                        gap: { base: '0.5', md: '2' },
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
                                bg: activeTab === tab.id ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                                color: activeTab === tab.id ? 'hudText' : 'hudTextMuted',
                                _hover: {
                                    color: 'hudText',
                                    bg: activeTab === tab.id ? 'rgba(255, 255, 255, 0.15)' : 'hudActionHover',
                                },
                            })}
                        >
                            <span className={css({ position: 'relative', display: 'inline-flex' })}>
                                {tab.icon}
                                {(badges[tab.id] ?? 0) > 0 && (
                                    <span
                                        className={css({
                                            position: 'absolute',
                                            top: '-4px',
                                            right: '-8px',
                                            minWidth: '16px',
                                            height: '16px',
                                            px: '1',
                                            borderRadius: 'full',
                                            bg: 'errorText',
                                            color: 'white',
                                            fontSize: '10px',
                                            fontWeight: '700',
                                            lineHeight: '16px',
                                            textAlign: 'center',
                                        })}
                                    >
                                        {badges[tab.id]}
                                    </span>
                                )}
                            </span>
                            <span
                                className={css({
                                    fontSize: { base: '10px', md: '11px' },
                                    fontWeight: '700',
                                    whiteSpace: 'nowrap',
                                    letterSpacing: { base: '-0.02em', md: 'normal' },
                                })}
                            >
                                {tab.label}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
