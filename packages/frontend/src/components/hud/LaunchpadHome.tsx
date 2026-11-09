import { ACCESS_TYPE_LABELS, type Instance, type WorldListItem } from '@ubichill/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { UserAvatar, useFriendLocations, useOpenUser } from '@/components/social';
import { accessIcon } from '@/components/social/accessIcon';
import { arrangeFriendPresence, type FriendWhere, onlineFriends } from '@/components/social/friendPresence';
import { useInstances } from '@/components/worlds/useInstances';
import { WorldDetailModal } from '@/components/worlds/WorldDetailModal';
import { css } from '@/styled-system/css';
import { HudIcon } from './HudIcon';
import type { HudTab } from './hudView';
import type { JoinInstanceHandler } from './tabs/shared';

/** ランチパッドのトップに並べるワールドの数（続きは「ワールド」の画面）。 */
const WORLD_STRIP_SIZE = 12;

interface LaunchpadHomeProps {
    instance: Instance | null;
    currentInstanceId: string;
    /** 今いる部屋が自分のホーム */
    isHome: boolean;
    goingHome: boolean;
    onGoHome: () => void;
    onInvite: () => void;
    onSelectTab: (tab: HudTab) => void;
    onCreateWorld: () => void;
    onJoinInstance: JoinInstanceHandler;
}

/**
 * ランチパッドのトップ。いまいる場所（とその場でする操作）、オンラインのフレンド、ワールドを並べ、
 * それぞれの見出しから一覧の画面へ進む。
 */
export function LaunchpadHome(props: LaunchpadHomeProps) {
    return (
        <div className={layout}>
            <CurrentPlace {...props} />
            <FriendsStrip instance={props.instance} onOpenSocial={() => props.onSelectTab('social')} />
            <WorldsStrip
                currentInstanceId={props.currentInstanceId}
                onOpenWorlds={() => props.onSelectTab('worlds')}
                onCreateWorld={props.onCreateWorld}
                onJoinInstance={props.onJoinInstance}
            />
        </div>
    );
}

function CurrentPlace({ instance, isHome, goingHome, onGoHome, onInvite, onSelectTab }: LaunchpadHomeProps) {
    return (
        <section className={banner} aria-label="現在地">
            {instance?.world.thumbnail && <img src={instance.world.thumbnail} alt="" className={bannerImage} />}
            <span className={bannerShade} />
            <button
                type="button"
                className={bannerHit}
                onClick={() => onSelectTab('instance')}
                aria-label="現在地を開く"
            />
            <div className={bannerBody}>
                {isHome && (
                    <span className={homeBadge}>
                        <HudIcon name="home" size={12} />
                        ホーム
                    </span>
                )}
                <h2 className={bannerTitle}>{instance?.world.displayName ?? '読み込み中...'}</h2>
                {instance && (
                    <p className={bannerMeta}>
                        <span className={metaItem}>
                            <HudIcon name={accessIcon(instance.access.type)} size={14} />
                            {ACCESS_TYPE_LABELS[instance.access.type]}
                        </span>
                        <span className={metaItem}>
                            <HudIcon name="user" size={14} />
                            {instance.stats.currentUsers}/{instance.stats.maxUsers}
                        </span>
                    </p>
                )}
            </div>
            <div className={bannerActions}>
                <button type="button" className={pill} onClick={onGoHome} disabled={isHome || goingHome}>
                    <HudIcon name="home" size={16} />
                    ホーム
                </button>
                <button type="button" className={pill} onClick={onInvite}>
                    <HudIcon name="userPlus" size={16} />
                    招待
                </button>
            </div>
        </section>
    );
}

function SectionHeader({
    title,
    count,
    onMore,
    extra,
}: {
    title: string;
    count?: number;
    onMore: () => void;
    extra?: ReactNode;
}) {
    return (
        <div className={sectionHeader}>
            <button type="button" className={moreLink} onClick={onMore}>
                {title}
                {count !== undefined && <span className={countText}>{count}</span>}
                <HudIcon name="chevron" size={16} />
            </button>
            {extra}
        </div>
    );
}

const whereLabel = (where: FriendWhere): string => {
    switch (where.kind) {
        case 'here':
            return 'ここにいます';
        case 'room':
            return where.instance.world.displayName;
        case 'hidden':
            return 'プライベート';
    }
};

function FriendsStrip({ instance, onOpenSocial }: { instance: Instance | null; onOpenSocial: () => void }) {
    const { data } = useFriendLocations();
    const openUser = useOpenUser();
    const online = data ? onlineFriends(arrangeFriendPresence(data, instance)) : [];
    return (
        <section className={section}>
            <SectionHeader title="フレンド" count={data ? online.length : undefined} onMore={onOpenSocial} />
            <div className={strip}>
                {online.map(({ user, where }) => (
                    <button key={user.id} type="button" className={face} onClick={() => openUser(user)}>
                        <span className={css({ position: 'relative', display: 'inline-flex' })}>
                            <UserAvatar user={user} size="lg" />
                            <span className={onlineDot} aria-hidden="true" />
                        </span>
                        <span className={faceName}>{user.name}</span>
                        <span className={faceWhere}>{whereLabel(where)}</span>
                    </button>
                ))}
                <button type="button" className={face} onClick={onOpenSocial} aria-label="ユーザーを探す">
                    <span className={findCircle}>
                        <HudIcon name="search" size={20} />
                    </span>
                </button>
                {data && online.length === 0 && <p className={emptyNote}>オンラインのフレンドはいません</p>}
            </div>
        </section>
    );
}

const byUpdated = (a: WorldListItem, b: WorldListItem) =>
    (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0);

function WorldsStrip({
    currentInstanceId,
    onOpenWorlds,
    onCreateWorld,
    onJoinInstance,
}: {
    currentInstanceId: string;
    onOpenWorlds: () => void;
    onCreateWorld: () => void;
    onJoinInstance: JoinInstanceHandler;
}) {
    const { worlds } = useInstances();
    const shown = useMemo(() => [...worlds].sort(byUpdated).slice(0, WORLD_STRIP_SIZE), [worlds]);
    const [selected, setSelected] = useState<WorldListItem | null>(null);
    return (
        <section className={section}>
            <SectionHeader
                title="ワールド"
                onMore={onOpenWorlds}
                extra={
                    <button
                        type="button"
                        className={iconButton}
                        onClick={onCreateWorld}
                        aria-label="ワールドを作る"
                        title="ワールドを作る"
                    >
                        <HudIcon name="plus" size={18} />
                    </button>
                }
            />
            <div className={strip}>
                {shown.map((world) => (
                    <button key={world.url} type="button" className={worldCard} onClick={() => setSelected(world)}>
                        <span className={worldThumb}>
                            {world.thumbnail ? (
                                <img src={world.thumbnail} alt="" className={worldImage} />
                            ) : (
                                <HudIcon name="globe" size={28} />
                            )}
                        </span>
                        <span className={worldName}>{world.displayName}</span>
                    </button>
                ))}
            </div>
            {selected && (
                <WorldDetailModal
                    worldId={selected.id}
                    initialWorld={selected}
                    currentInstanceId={currentInstanceId}
                    onJoinInstance={onJoinInstance}
                    onClose={() => setSelected(null)}
                />
            )}
        </section>
    );
}

const layout = css({
    display: 'flex',
    flexDirection: 'column',
    gap: { base: '5', md: '6' },
    h: 'full',
    overflowY: 'auto',
    pb: '2',
});

const banner = css({
    position: 'relative',
    flexShrink: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '3',
    minH: { base: '150px', md: '176px' },
    p: { base: '4', md: '5' },
    borderRadius: '12px',
    overflow: 'hidden',
    bg: 'primary',
    color: 'textOnPrimary',
});

const bannerImage = css({ position: 'absolute', inset: 0, w: 'full', h: 'full', objectFit: 'cover' });

const bannerShade = css({
    position: 'absolute',
    inset: 0,
    bg: 'linear-gradient(90deg, token(colors.bannerShade) 0%, token(colors.bannerShade) 35%, transparent 100%)',
    pointerEvents: 'none',
});

/** バナー全体を押せるようにする（中のボタンはこの上に重ねる） */
const bannerHit = css({
    position: 'absolute',
    inset: 0,
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'hudActionHover' },
});

const bannerBody = css({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '1.5',
    minW: 0,
    pointerEvents: 'none',
});

const homeBadge = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    px: '2',
    py: '0.5',
    borderRadius: '4px',
    bg: 'surface',
    color: 'text',
    fontSize: '11px',
    fontWeight: '800',
});

const bannerTitle = css({
    fontSize: { base: '20px', md: '26px' },
    fontWeight: '800',
    lineHeight: 1.2,
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});

const bannerMeta = css({ display: 'flex', flexWrap: 'wrap', gap: '3', fontSize: '13px', color: 'hudTextBody' });

const metaItem = css({ display: 'inline-flex', alignItems: 'center', gap: '1', whiteSpace: 'nowrap' });

const bannerActions = css({ position: 'relative', display: 'flex', gap: '2', flexShrink: 0 });

const pill = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    px: '3.5',
    py: '2',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '8px',
    bg: 'hudBg',
    backdropFilter: 'blur(6px)',
    color: 'hudText',
    fontSize: '13px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'hudBgHover' },
    _disabled: { opacity: 0.5, cursor: 'default', _hover: { bg: 'hudBg' } },
});

const section = css({ display: 'flex', flexDirection: 'column', gap: '2.5', flexShrink: 0 });

const sectionHeader = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' });

const moreLink = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    px: '1',
    py: '1',
    bg: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: 'text',
    fontSize: '16px',
    fontWeight: '800',
    cursor: 'pointer',
    '& > svg': { color: 'textSubtle', transition: 'color 0.16s ease' },
    _hover: { '& > svg': { color: 'text' } },
});

const countText = css({ color: 'textSubtle', fontSize: '14px', fontWeight: '700' });

const iconButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '34px',
    h: '34px',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'textMuted',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, color 0.16s ease',
    _hover: { bg: 'surfaceHover', color: 'text' },
});

const strip = css({
    display: 'flex',
    gap: '2',
    overflowX: 'auto',
    scrollSnapType: 'x proximity',
    pb: '1',
    scrollbarWidth: 'thin',
});

const face = css({
    flexShrink: 0,
    w: '84px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1',
    px: '1',
    py: '2',
    bg: 'transparent',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    scrollSnapAlign: 'start',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'surfaceHover' },
});

const onlineDot = css({
    position: 'absolute',
    right: '0',
    bottom: '0',
    w: '14px',
    h: '14px',
    borderRadius: 'full',
    bg: 'hudStatusOn',
    border: '2px solid',
    borderColor: 'background',
});

const faceName = css({
    maxW: 'full',
    fontSize: '12px',
    fontWeight: '700',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const faceWhere = css({
    maxW: 'full',
    fontSize: '11px',
    color: 'textMuted',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const emptyNote = css({ alignSelf: 'center', fontSize: '13px', color: 'textMuted', whiteSpace: 'nowrap' });

const findCircle = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '52px',
    h: '52px',
    borderRadius: 'full',
    border: '1.5px dashed',
    borderColor: 'borderStrong',
    color: 'textMuted',
});

const worldCard = css({
    flexShrink: 0,
    w: { base: '148px', md: '176px' },
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5',
    p: '0',
    bg: 'transparent',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    scrollSnapAlign: 'start',
    '& img': { transition: 'opacity 0.16s ease' },
    _hover: { '& img': { opacity: 0.85 } },
});

const worldThumb = css({
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: 'full',
    aspectRatio: '16 / 9',
    borderRadius: '8px',
    overflow: 'hidden',
    bg: 'secondary',
    color: 'textSubtle',
});

const worldImage = css({ position: 'absolute', inset: 0, w: 'full', h: 'full', objectFit: 'cover' });

const worldName = css({
    px: '0.5',
    fontSize: '13px',
    fontWeight: '700',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
