import { ACCESS_TYPE_LABELS, type Instance, type UserSummary } from '@ubichill/shared';
import { useNavigate } from 'react-router';
import type { FriendLocationsResponse } from '@/lib/socialApi';
import { userPagePath } from '@/lib/userPath';
import { css, cva } from '@/styled-system/css';
import { UserAvatar } from './UserAvatar';

const groupTitle = css({ fontSize: '15px', fontWeight: '700', color: 'text', mb: '2', lineClamp: 1 });

const chip = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '2',
        px: '3',
        py: '2',
        bg: 'surface',
        border: '1px solid',
        borderColor: 'border',
        borderRadius: '12px',
        cursor: 'pointer',
        textAlign: 'left',
        minWidth: 0,
        _hover: { bg: 'surfaceHover' },
    },
    variants: { muted: { true: { opacity: 0.7 } } },
});

function PeopleIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5" />
        </svg>
    );
}

function FriendChip({ user, muted }: { user: UserSummary; muted?: boolean }) {
    const navigate = useNavigate();
    return (
        <button type="button" className={chip({ muted })} onClick={() => navigate(userPagePath(user))}>
            <UserAvatar user={user} size="sm" />
            <span className={css({ minWidth: 0 })}>
                <span
                    className={css({
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: '600',
                        color: 'text',
                        lineClamp: 1,
                    })}
                >
                    {user.name}
                </span>
                {user.handle && (
                    <span className={css({ display: 'block', fontSize: '11px', color: 'textMuted', lineClamp: 1 })}>
                        @{user.handle}
                    </span>
                )}
            </span>
        </button>
    );
}

const friendGrid = css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '2' });

function InstanceCard({
    instance,
    friendCount,
    isHere,
    onJoin,
}: {
    instance: Instance;
    friendCount: number;
    isHere: boolean;
    onJoin: (instance: Instance) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onJoin(instance)}
            disabled={isHere}
            title={isHere ? 'いまここにいます' : 'このインスタンスに入る'}
            className={css({
                position: 'relative',
                width: { base: 'full', md: '200px' },
                flexShrink: 0,
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '12px',
                overflow: 'hidden',
                textAlign: 'left',
                cursor: 'pointer',
                _disabled: { cursor: 'default' },
                _hover: { borderColor: 'primary' },
            })}
        >
            <div className={css({ aspectRatio: '16 / 9', bg: 'secondary' })}>
                {instance.world.thumbnail && (
                    <img
                        src={instance.world.thumbnail}
                        alt=""
                        className={css({ width: 'full', height: 'full', objectFit: 'cover' })}
                    />
                )}
            </div>
            {isHere && (
                <span
                    className={css({
                        position: 'absolute',
                        top: '2',
                        left: '2',
                        px: '2',
                        py: '0.5',
                        borderRadius: '6px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        fontSize: '11px',
                        fontWeight: '700',
                    })}
                >
                    ここにいます
                </span>
            )}
            <div className={css({ p: '2' })}>
                <div className={css({ fontSize: '13px', fontWeight: '700', color: 'text', lineClamp: 1 })}>
                    {instance.world.displayName}
                </div>
                <div
                    className={css({
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3',
                        mt: '1',
                        fontSize: '12px',
                        color: 'textMuted',
                    })}
                >
                    <span
                        className={css({ display: 'inline-flex', alignItems: 'center', gap: '1' })}
                        title="参加している人"
                    >
                        <PeopleIcon />
                        {instance.stats.currentUsers}/{instance.stats.maxUsers}
                    </span>
                    <span title="フレンド" className={css({ whiteSpace: 'nowrap' })}>
                        フレンド {friendCount}
                    </span>
                </div>
            </div>
        </button>
    );
}

/**
 * フレンドの現在地（インスタンスごと。フレンドの多い順）。見えないインスタンスにいるフレンドは「非公開の場所」、
 * インスタンスにいないフレンドは「インスタンスにいない」にまとめる。
 */
export function FriendLocations({
    data,
    currentInstanceId,
    onJoin,
    showElsewhere = true,
}: {
    data: FriendLocationsResponse;
    currentInstanceId?: string;
    onJoin: (instance: Instance) => void;
    showElsewhere?: boolean;
}) {
    const section = css({ py: '3', borderBottom: '1px solid', borderColor: 'border', _last: { borderBottom: 'none' } });
    const empty = data.locations.length === 0 && data.private.length === 0;
    return (
        <div>
            {empty && (
                <p className={css({ fontSize: '13px', color: 'textMuted', py: '4' })}>
                    いまインスタンスにいるフレンドはいません。
                </p>
            )}
            {data.locations.map(({ instance, friends }) => (
                <section key={instance.id} className={section}>
                    <h3 className={groupTitle}>
                        {instance.world.displayName}
                        <span className={css({ ml: '2', fontSize: '12px', fontWeight: '500', color: 'textMuted' })}>
                            {ACCESS_TYPE_LABELS[instance.access.type]}
                        </span>
                    </h3>
                    <div className={css({ display: 'flex', flexDirection: { base: 'column', md: 'row' }, gap: '3' })}>
                        <InstanceCard
                            instance={instance}
                            friendCount={friends.length}
                            isHere={instance.id === currentInstanceId}
                            onJoin={onJoin}
                        />
                        <div className={css({ flex: 1, minWidth: 0 })}>
                            <div className={friendGrid}>
                                {friends.map((f) => (
                                    <FriendChip key={f.id} user={f} />
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            ))}
            {data.private.length > 0 && (
                <section className={section}>
                    <h3 className={groupTitle}>非公開の場所</h3>
                    <p className={css({ fontSize: '12px', color: 'textMuted', mb: '2' })}>
                        あなたには見えないインスタンス（フレンドのみ・招待のみなど）にいます
                    </p>
                    <div className={friendGrid}>
                        {data.private.map((f) => (
                            <FriendChip key={f.id} user={f} />
                        ))}
                    </div>
                </section>
            )}
            {showElsewhere && data.elsewhere.length > 0 && (
                <section className={section}>
                    <h3 className={groupTitle}>インスタンスにいない</h3>
                    <div className={friendGrid}>
                        {data.elsewhere.map((f) => (
                            <FriendChip key={f.id} user={f} muted />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
