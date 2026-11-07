import { ACCESS_TYPE_LABELS, type Instance } from '@ubichill/shared';
import { css, cva } from '@/styled-system/css';
import { HudIcon, type HudIconName } from './HudIcon';
import type { LaunchpadPage } from './hudView';

interface Tile {
    id: string;
    label: string;
    icon: HudIconName;
    onSelect: () => void;
}

interface QuickAction {
    id: string;
    label: string;
    icon: HudIconName;
    onSelect: () => void;
    disabled?: boolean;
}

interface LaunchpadHomeProps {
    instance: Instance | null;
    /** 今いる部屋が自分のホーム */
    isHome: boolean;
    onOpenPage: (page: LaunchpadPage) => void;
    onOpenInstance: () => void;
    onCreateWorld: () => void;
    onOpenHomeSettings: () => void;
    actions: {
        goHome: () => void;
        goingHome: boolean;
        respawn: () => void;
        copyInvite: () => void;
        logout: () => void;
    };
}

/** ランチパッドのトップ。今いる場所・よく使う画面への入口・すぐ使う操作を並べる。 */
export function LaunchpadHome({
    instance,
    isHome,
    onOpenPage,
    onOpenInstance,
    onCreateWorld,
    onOpenHomeSettings,
    actions,
}: LaunchpadHomeProps) {
    const tiles: Tile[] = [
        { id: 'worlds', label: 'ワールド', icon: 'globe', onSelect: () => onOpenPage('worlds') },
        { id: 'instances', label: 'インスタンス', icon: 'door', onSelect: () => onOpenPage('instances') },
        { id: 'social', label: 'ソーシャル', icon: 'users', onSelect: () => onOpenPage('social') },
        { id: 'profile', label: 'マイページ', icon: 'user', onSelect: () => onOpenPage('profile') },
        { id: 'create', label: 'ワールドを作る', icon: 'plus', onSelect: onCreateWorld },
        { id: 'home-settings', label: 'ホームの設定', icon: 'home', onSelect: onOpenHomeSettings },
    ];
    const quickActions: QuickAction[] = [
        {
            id: 'home',
            label: actions.goingHome ? '移動中...' : 'ホーム',
            icon: 'home',
            onSelect: actions.goHome,
            disabled: actions.goingHome,
        },
        { id: 'respawn', label: 'リスポーン', icon: 'respawn', onSelect: actions.respawn },
        { id: 'invite', label: '招待をコピー', icon: 'link', onSelect: actions.copyInvite },
        { id: 'logout', label: 'ログアウト', icon: 'logout', onSelect: actions.logout },
    ];

    return (
        <div className={layout}>
            <button type="button" className={banner} onClick={onOpenInstance} aria-label="現在地を開く">
                {instance?.world.thumbnail && <img src={instance.world.thumbnail} alt="" className={bannerImage} />}
                <span className={bannerShade} />
                <span className={bannerBody}>
                    <span className={bannerEyebrow}>
                        <HudIcon name="pin" size={14} />
                        現在地
                        {isHome && <span className={homeBadge}>ホーム</span>}
                    </span>
                    <span className={bannerTitle}>{instance?.world.displayName ?? '読み込み中...'}</span>
                    {instance && (
                        <span className={bannerMeta}>
                            {instance.stats.currentUsers} / {instance.stats.maxUsers} 人 ・{' '}
                            {ACCESS_TYPE_LABELS[instance.access.type]}
                        </span>
                    )}
                </span>
            </button>

            <div className={tileGrid}>
                {tiles.map((tile) => (
                    <button key={tile.id} type="button" className={tileButton} onClick={tile.onSelect}>
                        <span className={tileIcon}>
                            <HudIcon name={tile.icon} size={30} />
                        </span>
                        {tile.label}
                    </button>
                ))}
            </div>

            <div className={quickRow} role="toolbar" aria-label="クイックアクション">
                {quickActions.map((action) => (
                    <button
                        key={action.id}
                        type="button"
                        className={quickButton({ danger: action.id === 'logout' })}
                        onClick={action.onSelect}
                        disabled={action.disabled}
                    >
                        <HudIcon name={action.icon} size={18} />
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

const layout = css({
    display: 'flex',
    flexDirection: 'column',
    gap: { base: '4', md: '5' },
    h: 'full',
    overflowY: 'auto',
    pb: '2',
});

const banner = css({
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    minH: { base: '120px', md: '150px' },
    p: '0',
    border: 'none',
    borderRadius: '12px',
    overflow: 'hidden',
    bg: 'primary',
    color: 'textOnPrimary',
    textAlign: 'left',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'transform 0.16s ease',
    _hover: { transform: 'translateY(-1px)' },
});

const bannerImage = css({ position: 'absolute', inset: 0, w: 'full', h: 'full', objectFit: 'cover' });

const bannerShade = css({
    position: 'absolute',
    inset: 0,
    bg: 'linear-gradient(90deg, token(colors.bannerShade) 0%, token(colors.bannerShade) 35%, transparent 100%)',
});

const bannerBody = css({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '1',
    p: { base: '4', md: '5' },
    minW: 0,
});

const bannerEyebrow = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    fontSize: '12px',
    fontWeight: '700',
    color: 'hudTextMuted',
});

const homeBadge = css({
    ml: '1',
    px: '2',
    py: '0.5',
    borderRadius: 'full',
    bg: 'surface',
    color: 'text',
    fontSize: '11px',
});

const bannerTitle = css({
    fontSize: { base: '20px', md: '24px' },
    fontWeight: '800',
    lineHeight: 1.2,
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});

const bannerMeta = css({ fontSize: '13px', color: 'hudTextBody' });

const tileGrid = css({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: { base: '2', md: '3' },
});

const tileButton = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2',
    minH: { base: '92px', md: '112px' },
    px: '2',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
    color: 'text',
    fontSize: { base: '12px', md: '14px' },
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, transform 0.16s ease',
    _hover: { bg: 'surfaceHover', transform: 'translateY(-2px)' },
});

const tileIcon = css({ color: 'primary', display: 'inline-flex' });

const quickRow = css({
    display: 'grid',
    gridTemplateColumns: { base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
    gap: '2',
    mt: 'auto',
    pt: '2',
});

const quickButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2',
        py: '3',
        px: '3',
        border: 'none',
        borderRadius: 'full',
        bg: 'primary',
        color: 'textOnPrimary',
        fontSize: '13px',
        fontWeight: '700',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _hover: { bg: 'primaryHover' },
        _disabled: { opacity: 0.6, cursor: 'wait' },
    },
    variants: {
        danger: { true: { bg: 'surfaceAccent', color: 'errorText', _hover: { bg: 'errorBg' } } },
    },
});
