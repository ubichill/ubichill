import { ACCESS_TYPE_LABELS, type Instance, isFullFor } from '@ubichill/shared';
import { Children, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { HudIcon, type HudIconName } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';
import { accessIcon } from './accessIcon';
import { socialButton } from './buttons';
import { type FriendLocation, friendLocationOf, selfLocationOf } from './friendPresence';
import { UserAvatar } from './UserAvatar';
import { useFriendLocations } from './useFriendLocations';
import { useInviteActions } from './useInviteActions';

const MAX_FACES = 3;

/**
 * プロフィールに出す現在地（誰のプロフィールでも同じ枠を出す）。
 * - 自分: 今いる部屋（部屋の外なら「部屋にいません」）。
 * - フレンド: 入れる部屋はサムネイル・人数・そこにいるフレンドと「入る」、入れない・見えない部屋は「プライベートインスタンス」と
 *   「リクエスト」、部屋にいなければ「オフライン」。自分が部屋にいるときは「招待」も出す（同じ部屋にいるときは除く）。
 * - フレンドでない人・ログインしていないとき: 「非公開」。
 */
export function ProfileLocationCard({ userId, self, signedIn }: { userId: string; self: boolean; signedIn: boolean }) {
    if (!signedIn) return <StateCard state={STATES.unknown} />;
    return <SignedInLocationCard userId={userId} self={self} />;
}

function SignedInLocationCard({ userId, self }: { userId: string; self: boolean }) {
    const navigate = useNavigate();
    const hud = useHudNavigation();
    const viewerId = useSession().data?.user.id ?? null;
    const { data, error } = useFriendLocations();
    const { canInvite, currentInstanceId, invite, request } = useInviteActions();
    const [done, setDone] = useState({ invited: false, requested: false });
    const location: FriendLocation | null = self
        ? selfLocationOf(data, hud?.currentInstance ?? null)
        : data
          ? friendLocationOf(data, userId, currentInstanceId, Date.now())
          : error
            ? { kind: 'unknown' }
            : null;
    if (!location) return <section className={card} aria-label="現在地" aria-busy="true" />;

    const join = (instance: Instance) => {
        const worldData = { thumbnail: instance.world.thumbnail, displayName: instance.world.displayName };
        if (hud) hud.joinInstance(instance.id, instance.world.id, worldData);
        else navigate(`/instance/${instance.id}`, { state: { worldId: instance.world.id, worldData } });
    };
    const here = location.kind === 'room' && location.here;
    const inviteButton = canInvite && !self && !here && (
        <button
            type="button"
            className={socialButton()}
            disabled={done.invited}
            onClick={() => void invite({ id: userId }).then((ok) => ok && setDone((d) => ({ ...d, invited: true })))}
        >
            {done.invited ? '招待済み' : '招待'}
        </button>
    );

    if (location.kind !== 'room') {
        return (
            <StateCard
                state={STATES[location.kind]}
                lastKnown={location.kind === 'unreachable' ? location.lastKnown : undefined}
            >
                {location.kind === 'private' && (
                    <button
                        type="button"
                        className={socialButton({ tone: 'primary' })}
                        disabled={done.requested}
                        onClick={() =>
                            void request({ id: userId }).then((ok) => ok && setDone((d) => ({ ...d, requested: true })))
                        }
                    >
                        {done.requested ? '招待をリクエスト済み' : '招待をリクエスト'}
                    </button>
                )}
                {location.kind !== 'unknown' && inviteButton}
            </StateCard>
        );
    }

    const { instance, friends } = location;
    const { world, stats, access } = instance;
    return (
        <section className={card} aria-label="現在地">
            <div className={roomLayout}>
                <div className={thumb}>
                    {world.thumbnail ? (
                        <img src={world.thumbnail} alt="" className={thumbImage} />
                    ) : (
                        <HudIcon name="globe" size={32} />
                    )}
                    <span className={thumbLabel}>{here && !self ? 'いっしょにいます' : '現在地'}</span>
                </div>
                <div className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column', gap: '1.5' })}>
                    <h3 className={worldName}>{world.displayName}</h3>
                    <p className={meta}>
                        <Meta icon={accessIcon(access.type)}>{ACCESS_TYPE_LABELS[access.type]}</Meta>
                        {instance.remote && <Meta icon="globe">{instance.remote.domain}</Meta>}
                    </p>
                    <p className={meta}>
                        <Meta icon="user">
                            {stats.currentUsers}/{stats.maxUsers}
                        </Meta>
                        <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '1.5' })}>
                            <span className={faces}>
                                {friends.slice(0, MAX_FACES).map((f) => (
                                    <UserAvatar key={f.id} user={f} size="xs" />
                                ))}
                            </span>
                            フレンド {friends.length}
                        </span>
                    </p>
                    <div className={actions}>
                        {!here && (
                            <button
                                type="button"
                                className={socialButton({ tone: 'primary' })}
                                disabled={isFullFor(instance, viewerId)}
                                onClick={() => join(instance)}
                            >
                                {isFullFor(instance, viewerId) ? '満員' : '入る'}
                            </button>
                        )}
                        {inviteButton}
                    </div>
                </div>
            </div>
        </section>
    );
}

type LocationState = { title: string; icon: HudIconName };

const STATES: Record<Exclude<FriendLocation['kind'], 'room'>, LocationState> = {
    private: { title: 'プライベートインスタンス', icon: 'lock' },
    unreachable: { title: '確認できません', icon: 'globe' },
    offline: { title: 'オフライン', icon: 'user' },
    away: { title: '部屋にいません', icon: 'user' },
    unknown: { title: '非公開', icon: 'lock' },
};

function StateCard({ state, lastKnown, children }: { state: LocationState; lastKnown?: string; children?: ReactNode }) {
    const hasActions = Children.toArray(children).length > 0;
    return (
        <section className={card} aria-label="現在地">
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '3', p: '4' })}>
                <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                    <span className={stateIcon}>
                        <HudIcon name={state.icon} size={22} />
                    </span>
                    <div className={css({ flex: 1, minW: 0 })}>
                        <p className={label}>現在地</p>
                        <p className={stateTitle}>{state.title}</p>
                        {lastKnown && <p className={meta}>{lastKnown}</p>}
                    </div>
                </div>
                {hasActions && <div className={actions}>{children}</div>}
            </div>
        </section>
    );
}

function Meta({ icon, children }: { icon: HudIconName; children: ReactNode }) {
    return (
        <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '1', whiteSpace: 'nowrap' })}>
            <HudIcon name={icon} size={14} />
            {children}
        </span>
    );
}

/** 広い画面ではプロフィールの右の列、狭い画面ではプロフィールの下。 */
const card = css({
    flexShrink: 0,
    w: { lg: '300px' },
    mb: '4',
    bg: 'surface',
    borderRadius: '12px',
    overflow: 'hidden',
});

const roomLayout = css({ display: 'flex', flexDirection: 'column', gap: '3', p: '3' });

const thumb = css({
    position: 'relative',
    w: 'full',
    aspectRatio: '16 / 9',
    maxH: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    overflow: 'hidden',
    bg: 'secondary',
    color: 'textSubtle',
});

const thumbImage = css({ position: 'absolute', inset: 0, w: 'full', h: 'full', objectFit: 'cover' });

const thumbLabel = css({
    position: 'absolute',
    left: '2',
    top: '2',
    px: '2',
    py: '0.5',
    borderRadius: '6px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '11px',
    fontWeight: '700',
});

const worldName = css({
    fontSize: '16px',
    fontWeight: '800',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const meta = css({ display: 'flex', flexWrap: 'wrap', gap: '3', fontSize: '12px', color: 'textMuted' });

const faces = css({
    display: 'inline-flex',
    '& > *': { outline: '2px solid', outlineColor: 'surface' },
    '& > * + *': { ml: '-6px' },
});

const actions = css({ display: 'flex', flexWrap: 'wrap', gap: '2' });

const stateIcon = css({
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '44px',
    h: '44px',
    borderRadius: 'full',
    bg: 'secondary',
    color: 'textMuted',
});

const label = css({ fontSize: '11px', fontWeight: '700', color: 'textSubtle' });

const stateTitle = css({ fontSize: '15px', fontWeight: '800', color: 'text' });
