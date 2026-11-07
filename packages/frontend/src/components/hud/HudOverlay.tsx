import type { Instance } from '@ubichill/shared';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useNotifications } from '@/components/notifications';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { isHomeWorld } from '@/lib/home';
import { useHome } from '@/lib/homeStore';
import { fetchInstance } from '@/lib/instancesApi';
import { useMediaOutput } from '@/lib/mediaOutputSetting';
import { unreadBadge } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { css, cva } from '@/styled-system/css';
import { HudIcon, type HudIconName } from './HudIcon';
import { type HudNavigation, HudNavigationContext } from './HudNavigationContext';
import { type DockTab, type HudView, LAUNCHPAD_PAGE_TITLES } from './hudView';
import { LaunchpadHome } from './LaunchpadHome';
import { AudioTab } from './tabs/AudioTab';
import { InstancesTab } from './tabs/InstancesTab';
import { InstanceTab } from './tabs/InstanceTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { ProfileTab } from './tabs/ProfileTab';
import { type SettingsSection, SettingsTab } from './tabs/SettingsTab';
import { SocialTab } from './tabs/SocialTab';
import { WorldsTab } from './tabs/WorldsTab';
import { useHudActions } from './useHudActions';

interface HudOverlayProps {
    onClose: () => void;
    currentInstanceId: string;
}

/**
 * インスタンスの中で開くランチパッド。ページを移らずに、下のドックで画面を切り替える。
 * ランチパッドのトップには現在地・よく使う画面への入口・クイックアクション（ホーム・リスポーンなど）を置く。
 * 背景（パネルの外）を押すか Esc で閉じる。
 */
export function HudOverlay({ onClose, currentInstanceId }: HudOverlayProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const notifications = useNotifications();
    const { data: session } = useSession();
    const { home } = useHome();
    const [audio] = useMediaOutput();
    const actions = useHudActions({ currentInstanceId, onClose });
    const [view, setView] = useState<HudView>({ dock: 'launchpad' });
    const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
    const [visible, setVisible] = useState(false);
    const instance = useCurrentInstance(currentInstanceId);
    const contentId = useId();

    useEffect(() => {
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const navigation = useMemo<HudNavigation>(
        () => ({
            openSettings: (section) => {
                setSettingsSection(section);
                setView({ dock: 'settings' });
            },
        }),
        [],
    );

    const isHome =
        !!instance &&
        !!home &&
        instance.leaderId === session?.user.id &&
        instance.access.type === home.accessType &&
        isHomeWorld(instance.world, home);

    const dockItems: Array<{ id: DockTab; label: string; icon: HudIconName; badge?: string | null }> = [
        { id: 'launchpad', label: 'ランチパッド', icon: 'rocket' },
        { id: 'notifications', label: '通知', icon: 'bell', badge: unreadBadge(notifications.feed.unreadCount) },
        { id: 'instance', label: '現在地', icon: 'pin' },
        { id: 'audio', label: '音声', icon: audio.muted ? 'mute' : 'volume' },
        { id: 'settings', label: '設定', icon: 'gear' },
    ];

    const createWorld = async () => {
        if (!(await confirm('ワールドの作成画面に移動しますか？現在のインスタンスから退出します。'))) return;
        navigate('/worlds/new');
        onClose();
    };

    const content = (): ReactNode => {
        switch (view.dock) {
            case 'launchpad':
                switch (view.page) {
                    case 'worlds':
                        return (
                            <WorldsTab onJoinInstance={actions.joinInstance} currentInstanceId={currentInstanceId} />
                        );
                    case 'instances':
                        return (
                            <InstancesTab onJoinInstance={actions.joinInstance} currentInstanceId={currentInstanceId} />
                        );
                    case 'social':
                        return (
                            <SocialTab
                                currentInstanceId={currentInstanceId}
                                onJoinInstance={actions.joinInstance}
                                onFriendshipChange={() => void notifications.reload()}
                            />
                        );
                    case 'profile':
                        return <ProfileTab onNavigate={onClose} onJoinInstance={actions.joinInstance} />;
                    default:
                        return (
                            <LaunchpadHome
                                instance={instance}
                                isHome={isHome}
                                onOpenPage={(page) => setView({ dock: 'launchpad', page })}
                                onOpenInstance={() => setView({ dock: 'instance' })}
                                onCreateWorld={() => void createWorld()}
                                onOpenHomeSettings={() => navigation.openSettings('home')}
                                actions={{
                                    goHome: () => void actions.goHome(),
                                    goingHome: actions.goingHome,
                                    respawn: actions.respawn,
                                    copyInvite: () => void actions.copyInvite(),
                                    logout: () => void actions.logout(),
                                }}
                            />
                        );
                }
            case 'notifications':
                return <NotificationsTab onNavigate={onClose} />;
            case 'instance':
                return <InstanceTab currentInstanceId={currentInstanceId} onNavigate={onClose} />;
            case 'audio':
                return <AudioTab />;
            case 'settings':
                return (
                    <SettingsTab
                        section={settingsSection}
                        onSectionChange={setSettingsSection}
                        onNavigate={onClose}
                        onJoinInstance={actions.joinInstance}
                    />
                );
        }
    };

    const userName = session?.user.name ?? '';
    const avatar = session?.user.image;

    return (
        <HudNavigationContext.Provider value={navigation}>
            <div className={backdrop} data-open={visible} onClick={onClose}>
                <div className={frame} onClick={(e) => e.stopPropagation()}>
                    <section className={panel} role="dialog" aria-modal="true" aria-label="ランチパッド">
                        <header className={header}>
                            <button
                                type="button"
                                className={accountChip}
                                onClick={() => setView({ dock: 'launchpad', page: 'profile' })}
                            >
                                {avatar ? (
                                    <img src={avatar} alt="" className={avatarStyle} />
                                ) : (
                                    <span className={avatarStyle}>{[...userName][0] ?? ''}</span>
                                )}
                                <span className={css({ display: 'flex', flexDirection: 'column', minW: 0 })}>
                                    <span className={accountName}>{userName}</span>
                                    <span className={css({ fontSize: '11px', color: 'hudTextMuted' })}>マイページ</span>
                                </span>
                            </button>
                            <Clock />
                            <button type="button" className={iconButton} aria-label="閉じる" onClick={onClose}>
                                <HudIcon name="close" />
                            </button>
                        </header>

                        <div className={body}>
                            {view.dock === 'launchpad' && view.page && (
                                <div className={pageHeader}>
                                    <button
                                        type="button"
                                        className={backButton}
                                        onClick={() => setView({ dock: 'launchpad' })}
                                    >
                                        <HudIcon name="back" size={16} />
                                        ランチパッド
                                    </button>
                                    <h2 className={css({ fontSize: '17px', fontWeight: '800', color: 'text' })}>
                                        {LAUNCHPAD_PAGE_TITLES[view.page]}
                                    </h2>
                                </div>
                            )}
                            <div id={contentId} className={contentArea}>
                                {content()}
                            </div>
                        </div>
                    </section>

                    <nav className={dock} aria-label="メインメニュー">
                        {dockItems.map((item) => {
                            const active = view.dock === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    aria-pressed={active}
                                    aria-controls={contentId}
                                    className={dockButton({ active })}
                                    onClick={() => setView({ dock: item.id })}
                                >
                                    <span className={css({ position: 'relative', display: 'inline-flex' })}>
                                        <HudIcon name={item.icon} />
                                        {item.badge && (
                                            <span role="status" aria-label={`未読 ${item.badge} 件`} className={badge}>
                                                {item.badge}
                                            </span>
                                        )}
                                    </span>
                                    <span className={dockLabel}>{item.label}</span>
                                </button>
                            );
                        })}
                    </nav>
                </div>
            </div>
        </HudNavigationContext.Provider>
    );
}

function useCurrentInstance(instanceId: string): Instance | null {
    const [instance, setInstance] = useState<Instance | null>(null);
    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchInstance(instanceId)
            .then((data) => {
                if (!ctrl.cancelled) setInstance(data);
            })
            .catch(() => undefined);
        return () => {
            ctrl.cancelled = true;
        };
    }, [instanceId]);
    return instance;
}

const timeFormat = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });

function Clock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 10_000);
        return () => clearInterval(timer);
    }, []);
    return (
        <time dateTime={now.toISOString()} className={clock}>
            {timeFormat.format(now)}
        </time>
    );
}

const backdrop = css({
    position: 'fixed',
    inset: 0,
    zIndex: 10010,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bg: 'hudBackdrop',
    backdropFilter: 'blur(4px)',
    opacity: 0,
    transition: 'opacity 0.2s ease',
    '&[data-open="true"]': { opacity: 1 },
});

const frame = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '3',
    w: 'min(780px, calc(100vw - 16px))',
    h: {
        base: 'calc(100dvh - 24px - env(safe-area-inset-bottom, 0px))',
        md: 'min(820px, calc(100dvh - 48px))',
    },
});

const panel = css({
    flex: 1,
    minH: 0,
    display: 'flex',
    flexDirection: 'column',
    bg: 'background',
    borderRadius: '12px',
    border: '1px solid',
    borderColor: 'hudBorder',
    boxShadow: 'modal',
    overflow: 'hidden',
});

const header = css({
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    gap: '3',
    px: { base: '3', md: '4' },
    py: '3',
    bg: 'primary',
    color: 'textOnPrimary',
});

const accountChip = css({
    justifySelf: 'start',
    display: 'flex',
    alignItems: 'center',
    gap: '2.5',
    minW: 0,
    maxW: 'full',
    py: '1.5',
    pl: '1.5',
    pr: '3',
    bg: 'hudActionHover',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '12px',
    color: 'textOnPrimary',
    textAlign: 'left',
    cursor: 'pointer',
    _hover: { bg: 'hudActive' },
});

const avatarStyle = css({
    w: '34px',
    h: '34px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'full',
    objectFit: 'cover',
    bg: 'surfaceAccent',
    color: 'text',
    fontSize: '15px',
    fontWeight: '800',
});

const accountName = css({
    fontSize: '14px',
    fontWeight: '700',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const clock = css({
    fontSize: { base: '20px', md: '26px' },
    fontWeight: '800',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.02em',
});

const iconButton = css({
    justifySelf: 'end',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '40px',
    h: '40px',
    bg: 'transparent',
    border: 'none',
    borderRadius: '10px',
    color: 'hudTextMuted',
    cursor: 'pointer',
    _hover: { bg: 'hudActionHover', color: 'hudText' },
});

const body = css({
    flex: 1,
    minH: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    p: { base: '3', md: '5' },
});

const pageHeader = css({ display: 'flex', alignItems: 'center', gap: '3', flexShrink: 0 });

const backButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    px: '3',
    py: '1.5',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: 'full',
    color: 'textMuted',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    _hover: { color: 'text', borderColor: 'borderStrong' },
});

const contentArea = css({ flex: 1, minH: 0 });

const dock = css({
    flexShrink: 0,
    display: 'flex',
    gap: { base: '0.5', md: '1.5' },
    p: { base: '1.5', md: '2' },
    bg: 'primary',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '12px',
});

const dockButton = cva({
    base: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1',
        py: '2',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease, color 0.16s ease',
    },
    variants: {
        active: {
            true: { bg: 'hudActive', color: 'hudText' },
            false: { bg: 'transparent', color: 'hudTextMuted', _hover: { bg: 'hudActionHover', color: 'hudText' } },
        },
    },
});

const dockLabel = css({
    fontSize: { base: '10px', md: '11px' },
    fontWeight: '700',
    whiteSpace: 'nowrap',
});

const badge = css({
    position: 'absolute',
    top: '-4px',
    right: '-8px',
    minW: '16px',
    h: '16px',
    px: '1',
    borderRadius: 'full',
    bg: 'errorText',
    color: 'white',
    fontSize: '10px',
    fontWeight: '700',
    lineHeight: '16px',
    textAlign: 'center',
});
