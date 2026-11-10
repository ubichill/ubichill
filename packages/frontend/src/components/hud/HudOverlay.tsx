import type { Instance } from '@ubichill/shared';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useNotifications } from '@/components/notifications';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useIsAdmin } from '@/lib/account/useIsAdmin';
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
    goBack,
    type HudPage,
    type HudTab,
    type HudView,
    INITIAL_HUD_VIEW,
    isTabVisible,
    openPage,
    openUser,
    pageTitle,
    selectTab,
    visibleView,
} from './hudView';
import { LaunchpadHome } from './LaunchpadHome';
import { AudioTab } from './tabs/AudioTab';
import { type ControlPanelSection, ControlPanelTab } from './tabs/ControlPanelTab';
import { InstanceTab } from './tabs/InstanceTab';
import { InviteTab } from './tabs/InviteTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { ProfileTab } from './tabs/ProfileTab';
import { type SettingsSection, SettingsTab } from './tabs/SettingsTab';
import { type SocialSection, SocialTab } from './tabs/SocialTab';
import { type WorldsSection, WorldsTab } from './tabs/WorldsTab';
import { useHudActions } from './useHudActions';

interface HudOverlayProps {
    onClose: () => void;
    currentInstanceId: string;
}

interface TabItem {
    id: HudTab;
    label: string;
    icon: HudIconName;
    /** 縦の列で名前を折り返してよい（長い名前。折り返す位置は名前の中の U+200B） */
    wrap?: boolean;
}

/** 下: その場のことと通知。 */
const PLACE_ITEMS: readonly TabItem[] = [
    { id: 'launchpad', label: 'ランチパッド', icon: 'rocket' },
    { id: 'instance', label: '現在地', icon: 'pin' },
    { id: 'audio', label: '音声', icon: 'volume' },
    { id: 'notifications', label: '通知', icon: 'bell' },
];

/** 左: 探すもの・人・自分（中でさらに左で切り替える）。プロフィールはアカウントのアイコン。 */
const PERSON_ITEMS: readonly TabItem[] = [
    { id: 'profile', label: 'プロフィール', icon: 'user' },
    { id: 'worlds', label: 'ワールド', icon: 'globe' },
    { id: 'social', label: 'ソーシャル', icon: 'users' },
    { id: 'settings', label: '設定', icon: 'gear' },
    { id: 'control', label: 'コントロール\u200bパネル', icon: 'shield', wrap: true },
];

/**
 * インスタンスの中で開くランチパッド。ページを移らずに、左（探すもの・人・自分）と下（その場のことと通知）のタブで画面を切り替え、
 * その上に画面を重ねて進む。
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
    // 中の切り替えはタブを離れても覚えておく（人を開いて戻ったときに同じ欄に帰る）
    const [worldsSection, setWorldsSection] = useState<WorldsSection>('local');
    const [socialSection, setSocialSection] = useState<SocialSection>('locations');
    const [settingsSection, setSettingsSection] = useState<SettingsSection>('home');
    const [controlSection, setControlSection] = useState<ControlPanelSection>('users');
    const [visible, setVisible] = useState(false);
    const instance = useCurrentInstance(currentInstanceId);
    const isHome = !!instance && isHomeInstance(instance, home, session?.user.id);
    const actions = useHudActions({ currentInstanceId, isHome, onClose });
    const contentId = useId();
    const selfId = session?.user.id;
    const isAdmin = useIsAdmin(selfId);
    const shown = visibleView(view, isAdmin);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const navigation = useMemo<HudNavigation>(
        () => ({
            currentInstanceId,
            currentInstance: instance,
            openWorlds: (section) => {
                setWorldsSection(section);
                setView(selectTab('worlds'));
            },
            openUser: (userId) => setView((v) => openUser(v, userId, selfId)),
            joinInstance: actions.joinInstance,
        }),
        [currentInstanceId, instance, selfId, actions.joinInstance],
    );
    const open = (page: HudPage) => setView((v) => openPage(v, page));
    const select = (tab: HudTab) => setView(selectTab(tab));
    const findUsers = () => {
        setSocialSection('search');
        select('social');
    };

    const createWorld = async () => {
        if (!(await confirm('ワールドの作成画面に移動しますか？現在のインスタンスから退出します。'))) return;
        navigate('/worlds/new');
        onClose();
    };

    const page = currentPage(shown);
    const title = page ? pageTitle(page) : null;

    const pageContent = (p: HudPage): ReactNode => {
        switch (p.kind) {
            case 'invite':
                return (
                    <InviteTab
                        instance={instance}
                        currentInstanceId={currentInstanceId}
                        onCopyLink={() => void actions.copyInvite()}
                        onFindFriends={findUsers}
                    />
                );
            case 'user':
                return <ProfileTab userId={p.userId} onNavigate={onClose} onJoinInstance={actions.joinInstance} />;
        }
    };

    const tabContent = (): ReactNode => {
        switch (shown.tab) {
            case 'launchpad':
                return (
                    <LaunchpadHome
                        instance={instance}
                        currentInstanceId={currentInstanceId}
                        isHome={isHome}
                        goingHome={actions.goingHome}
                        onGoHome={() => void actions.goHome()}
                        onInvite={() => open({ kind: 'invite' })}
                        onSelectTab={select}
                        onFindUsers={findUsers}
                        onCreateWorld={() => void createWorld()}
                        onJoinInstance={actions.joinInstance}
                    />
                );
            case 'worlds':
                return (
                    <WorldsTab
                        section={worldsSection}
                        onSectionChange={setWorldsSection}
                        onJoinInstance={actions.joinInstance}
                        currentInstanceId={currentInstanceId}
                        onNavigate={onClose}
                    />
                );
            case 'instance':
                return <InstanceTab currentInstanceId={currentInstanceId} onNavigate={onClose} />;
            case 'audio':
                return <AudioTab />;
            case 'profile':
                return <ProfileTab onNavigate={onClose} onJoinInstance={actions.joinInstance} />;
            case 'notifications':
                return <NotificationsTab onNavigate={onClose} />;
            case 'social':
                return (
                    <SocialTab
                        section={socialSection}
                        onSectionChange={setSocialSection}
                        currentInstance={instance}
                        onJoinInstance={actions.joinInstance}
                        onFriendshipChange={() => void notifications.reload()}
                    />
                );
            case 'settings':
                return <SettingsTab section={settingsSection} onSectionChange={setSettingsSection} />;
            case 'control':
                return <ControlPanelTab section={controlSection} onSectionChange={setControlSection} />;
        }
    };

    const userName = session?.user.name ?? '';
    const unread = unreadBadge(notifications.feed.unreadCount);
    const tabButton = (item: TabItem, placement: 'rail' | 'dock') => {
        const active = shown.tab === item.id;
        const badge = item.id === 'notifications' ? unread : null;
        const icon = item.id === 'audio' && audio.muted ? 'mute' : item.icon;
        return (
            <button
                key={item.id}
                type="button"
                aria-pressed={active}
                aria-controls={contentId}
                className={tabButtonStyle({ active, placement })}
                onClick={() => select(item.id)}
            >
                <span className={css({ position: 'relative', display: 'inline-flex' })}>
                    {item.id === 'profile' && session ? (
                        <AccountAvatar name={userName} image={session.user.image ?? null} />
                    ) : (
                        <HudIcon name={icon} />
                    )}
                    {badge && (
                        <span role="status" aria-label={`未読 ${badge} 件`} className={badgeStyle}>
                            {badge}
                        </span>
                    )}
                </span>
                <span className={tabLabel({ wrap: !!item.wrap })}>
                    {item.id === 'profile' && userName ? userName : item.label}
                </span>
            </button>
        );
    };

    return (
        <HudNavigationContext.Provider value={navigation}>
            <div className={backdrop} data-open={visible} onClick={onClose}>
                <div className={frame} onClick={(e) => e.stopPropagation()}>
                    <div className={main}>
                        <nav className={rail} aria-label="メニュー">
                            {PERSON_ITEMS.filter((item) => isTabVisible(item.id, isAdmin)).map((item) =>
                                tabButton(item, 'rail'),
                            )}
                        </nav>
                        <section
                            className={panel}
                            role="dialog"
                            aria-modal="true"
                            aria-label="ランチパッド"
                            data-launchpad=""
                        >
                            <header className={header}>
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
                                    {page ? pageContent(page) : tabContent()}
                                </div>
                            </div>
                        </section>
                    </div>

                    <nav className={dock} aria-label="その場と通知">
                        {PLACE_ITEMS.map((item) => tabButton(item, 'dock'))}
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

/** プロフィールのタブのアイコン: アカウントの画像。無ければ名前の頭文字（タブの暗い地で見える色にする）。 */
function AccountAvatar({ name, image }: { name: string; image: string | null }) {
    if (image) return <img src={image} alt="" className={accountAvatar} />;
    return (
        <span className={accountAvatar} aria-hidden="true">
            {Array.from(name)[0] ?? '?'}
        </span>
    );
}

const accountAvatar = css({
    w: '24px',
    h: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'full',
    objectFit: 'cover',
    bg: 'hudAvatar',
    color: 'hudText',
    fontSize: '12px',
    fontWeight: '800',
});

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
    w: {
        base: 'calc(100vw - 16px)',
        md: 'min(900px, calc(100vw - 32px))',
        lg: 'min(1160px, calc(100vw - 48px))',
    },
    h: {
        base: 'calc(100dvh - 24px - env(safe-area-inset-bottom, 0px))',
        md: 'min(820px, calc(100dvh - 48px))',
    },
});

/** 左のタブとパネル（狭い画面ではタブをパネルの上に横に並べる）。 */
const main = css({
    flex: 1,
    minH: 0,
    display: 'flex',
    flexDirection: { base: 'column', md: 'row' },
    gap: '3',
});

const rail = css({
    flexShrink: 0,
    display: 'flex',
    flexDirection: { base: 'row', md: 'column' },
    gap: { base: '0.5', md: '1.5' },
    w: { md: '92px' },
    p: { base: '1.5', md: '2' },
    bg: 'primary',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '12px',
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
    gridTemplateColumns: '40px 1fr 40px',
    justifyItems: 'center',
    '& > time': { gridColumn: '2' },
    alignItems: 'center',
    gap: '3',
    px: { base: '3', md: '4' },
    py: '3',
    bg: 'primary',
    color: 'textOnPrimary',
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

const tabButtonStyle = cva({
    base: {
        flex: 1,
        minW: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1',
        py: '2',
        px: '1',
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
        placement: {
            // 縦に並べるときは、高さを詰めて上から並べる
            rail: { md: { flex: 'none', py: '2.5' } },
            dock: {},
        },
    },
});

const tabLabel = cva({
    base: {
        maxW: 'full',
        fontSize: { base: '10px', md: '11px' },
        fontWeight: '700',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    variants: {
        wrap: {
            // 語の途中では折り返さず、名前に入れた折り返しの位置（U+200B）でだけ折り返す
            true: { whiteSpace: 'normal', wordBreak: 'keep-all', textAlign: 'center', lineHeight: '1.25' },
        },
    },
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
