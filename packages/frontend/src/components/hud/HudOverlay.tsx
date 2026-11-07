import type { Instance } from '@ubichill/shared';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useNotifications } from '@/components/notifications';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { isHomeInstance } from '@/lib/home';
import { useHome } from '@/lib/homeStore';
import { fetchInstance } from '@/lib/instancesApi';
import { useMediaOutput } from '@/lib/mediaOutputSetting';
import { unreadBadge } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { css, cva } from '@/styled-system/css';
import { HudIcon, type HudIconName } from './HudIcon';
import { type HudNavigation, HudNavigationContext } from './HudNavigationContext';
import {
    currentPage,
    type DockTab,
    goBack,
    type HudPage,
    type HudView,
    INITIAL_HUD_VIEW,
    openPage,
    pageTitle,
    selectDock,
} from './hudView';
import { LaunchpadHome } from './LaunchpadHome';
import { AudioTab } from './tabs/AudioTab';
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

const DOCK_ITEMS: ReadonlyArray<{ id: DockTab; label: string; icon: HudIconName }> = [
    { id: 'launchpad', label: 'ランチパッド', icon: 'rocket' },
    { id: 'notifications', label: '通知', icon: 'bell' },
    { id: 'instance', label: '現在地', icon: 'pin' },
    { id: 'audio', label: '音声', icon: 'volume' },
    { id: 'settings', label: '設定', icon: 'gear' },
];

/**
 * インスタンスの中で開くランチパッド。ページを移らずに、下のドックで画面を切り替え、その上に画面を重ねて進む。
 * 背景（パネルの外）を押すか Esc（InstanceHUD）で閉じる。
 */
export function HudOverlay({ onClose, currentInstanceId }: HudOverlayProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const notifications = useNotifications();
    const { data: session } = useSession();
    const { home } = useHome();
    const [audio] = useMediaOutput();
    const [view, setView] = useState<HudView>(INITIAL_HUD_VIEW);
    const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
    const [visible, setVisible] = useState(false);
    const instance = useCurrentInstance(currentInstanceId);
    const isHome = !!instance && isHomeInstance(instance, home, session?.user.id);
    const actions = useHudActions({ currentInstanceId, isHome, onClose });
    const contentId = useId();
    const selfId = session?.user.id;

    useEffect(() => {
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const navigation = useMemo<HudNavigation>(
        () => ({
            openSettings: (section) => {
                setSettingsSection(section);
                setView(selectDock('settings'));
            },
            openUser: (userId) =>
                setView((v) => openPage(v, userId === selfId ? { kind: 'profile' } : { kind: 'user', userId })),
        }),
        [selfId],
    );
    const open = (page: HudPage) => setView((v) => openPage(v, page));

    const createWorld = async () => {
        if (!(await confirm('ワールドの作成画面に移動しますか？現在のインスタンスから退出します。'))) return;
        navigate('/worlds/new');
        onClose();
    };

    const page = currentPage(view);
    const title = page ? pageTitle(page) : null;

    const pageContent = (p: HudPage): ReactNode => {
        switch (p.kind) {
            case 'worlds':
                return <WorldsTab onJoinInstance={actions.joinInstance} currentInstanceId={currentInstanceId} />;
            case 'social':
                return (
                    <SocialTab
                        currentInstance={instance}
                        onJoinInstance={actions.joinInstance}
                        onFriendshipChange={() => void notifications.reload()}
                    />
                );
            case 'profile':
                return <ProfileTab onNavigate={onClose} onJoinInstance={actions.joinInstance} />;
            case 'user':
                return <ProfileTab userId={p.userId} onNavigate={onClose} onJoinInstance={actions.joinInstance} />;
        }
    };

    const dockContent = (): ReactNode => {
        switch (view.dock) {
            case 'launchpad':
                return (
                    <LaunchpadHome
                        instance={instance}
                        currentInstanceId={currentInstanceId}
                        isHome={isHome}
                        goingHome={actions.goingHome}
                        onGoHome={() => void actions.goHome()}
                        onCopyInvite={() => void actions.copyInvite()}
                        onOpenInstance={() => setView(selectDock('instance'))}
                        onOpenPage={open}
                        onCreateWorld={() => void createWorld()}
                        onJoinInstance={actions.joinInstance}
                    />
                );
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
    const unread = unreadBadge(notifications.feed.unreadCount);

    return (
        <HudNavigationContext.Provider value={navigation}>
            <div className={backdrop} data-open={visible} onClick={onClose}>
                <div className={frame} onClick={(e) => e.stopPropagation()}>
                    <section
                        className={panel}
                        role="dialog"
                        aria-modal="true"
                        aria-label="ランチパッド"
                        data-launchpad=""
                    >
                        <header className={header}>
                            <button
                                type="button"
                                className={accountChip}
                                onClick={() => open({ kind: 'profile' })}
                                aria-label={`${userName}（プロフィール）`}
                            >
                                {avatar ? (
                                    <img src={avatar} alt="" className={avatarStyle} />
                                ) : (
                                    <span className={avatarStyle}>{[...userName][0] ?? ''}</span>
                                )}
                                <span className={accountName}>{userName}</span>
                            </button>
                            <Clock />
                            <button type="button" className={iconButton} aria-label="閉じる" onClick={onClose}>
                                <HudIcon name="close" />
                            </button>
                        </header>

                        <div className={body}>
                            {page && (
                                <div className={pageHeader}>
                                    <button
                                        type="button"
                                        className={backButton}
                                        aria-label="戻る"
                                        onClick={() => setView(goBack)}
                                    >
                                        <HudIcon name="back" size={20} />
                                    </button>
                                    {title && <h2 className={pageTitleStyle}>{title}</h2>}
                                </div>
                            )}
                            <div id={contentId} className={contentArea}>
                                {page ? pageContent(page) : dockContent()}
                            </div>
                        </div>
                    </section>

                    <nav className={dock} aria-label="メインメニュー">
                        {DOCK_ITEMS.map((item) => {
                            const active = view.dock === item.id;
                            const icon = item.id === 'audio' && audio.muted ? 'mute' : item.icon;
                            const badge = item.id === 'notifications' ? unread : null;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    aria-pressed={active}
                                    aria-controls={contentId}
                                    className={dockButton({ active })}
                                    onClick={() => setView(selectDock(item.id))}
                                >
                                    <span className={css({ position: 'relative', display: 'inline-flex' })}>
                                        <HudIcon name={icon} />
                                        {badge && (
                                            <span role="status" aria-label={`未読 ${badge} 件`} className={badgeStyle}>
                                                {badge}
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
    py: '1',
    pl: '1',
    pr: '3',
    bg: 'transparent',
    border: 'none',
    borderRadius: '10px',
    color: 'textOnPrimary',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'hudActionHover' },
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

const pageHeader = css({ display: 'flex', alignItems: 'center', gap: '1.5', flexShrink: 0, ml: '-2' });

const backButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '36px',
    h: '36px',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'text',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'surfaceHover' },
});

const pageTitleStyle = css({ fontSize: '18px', fontWeight: '800', color: 'text' });

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

const badgeStyle = css({
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
