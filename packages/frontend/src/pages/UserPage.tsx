import { LIMITS } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';

interface UserProfile {
    id: string;
    name: string;
    username: string | null;
    profileImageUrl: string | null;
}

interface OwnedWorld {
    id: string;
    displayName: string;
    description: string | null;
    thumbnail: string | null;
    version: string;
    capacity: { default: number; max: number };
    updatedAt?: string;
}

export function UserPage() {
    const navigate = useNavigate();
    const { userId: routeUserId } = useParams<{ userId?: string }>();
    const { data: session, isPending } = useSession();

    const isMe = !routeUserId; // /user/me → routeUserId 未定義
    const targetUserId = isMe ? session?.user.id : routeUserId;
    const isOwnPage = !!session && targetUserId === session.user.id;

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [worlds, setWorlds] = useState<OwnedWorld[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isPending) return;
        if (!targetUserId) {
            navigate('/auth');
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError('');

        const profileUrl = isOwnPage ? `${API_BASE}/api/v1/users/me` : `${API_BASE}/api/v1/users/${targetUserId}`;
        const worldsUrl = isOwnPage
            ? `${API_BASE}/api/v1/users/me/worlds`
            : `${API_BASE}/api/v1/users/${targetUserId}/worlds`;

        Promise.all([fetch(profileUrl, { credentials: 'include' }), fetch(worldsUrl, { credentials: 'include' })])
            .then(async ([pRes, wRes]) => {
                if (cancelled) return;
                if (!pRes.ok) throw new Error(`プロフィール取得失敗 (${pRes.status})`);
                if (!wRes.ok) throw new Error(`ワールド取得失敗 (${wRes.status})`);
                const pData = (await pRes.json()) as UserProfile;
                const wData = (await wRes.json()) as { worlds: OwnedWorld[] };
                if (cancelled) return;
                setProfile(pData);
                setWorlds(wData.worlds);
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : '読み込み失敗');
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isPending, targetUserId, isOwnPage, navigate]);

    if (isPending || loading) {
        return (
            <div
                className={css({
                    minH: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'textMuted',
                })}
            >
                読み込み中...
            </div>
        );
    }

    const remaining = Math.max(0, LIMITS.MAX_WORLDS_PER_USER - worlds.length);
    const canCreate = isOwnPage && remaining > 0;

    return (
        <div
            className={css({
                width: 'full',
                maxW: '4xl',
                mx: 'auto',
                p: { base: '4', md: '6' },
                minH: '100vh',
            })}
        >
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2',
                    mb: '4',
                })}
            >
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className={css({
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        bg: 'surface',
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '10px',
                        color: 'textMuted',
                        fontSize: '13px',
                        cursor: 'pointer',
                        _hover: { borderColor: 'borderStrong' },
                    })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                    ロビーへ
                </button>
            </div>

            {/* プロフィールカード */}
            {profile && (
                <div
                    className={css({
                        bg: 'surfaceAccent',
                        borderRadius: '16px',
                        p: { base: '4', md: '6' },
                        mb: '4',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4',
                    })}
                >
                    <div
                        className={css({
                            width: { base: '60px', md: '80px' },
                            height: { base: '60px', md: '80px' },
                            borderRadius: '50%',
                            bg: 'primary',
                            color: 'textOnPrimary',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: { base: 'xl', md: '2xl' },
                            fontWeight: '700',
                            overflow: 'hidden',
                            flexShrink: 0,
                        })}
                    >
                        {profile.profileImageUrl ? (
                            <img
                                src={profile.profileImageUrl}
                                alt={profile.name}
                                className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                            />
                        ) : (
                            profile.name.charAt(0).toUpperCase()
                        )}
                    </div>
                    <div className={css({ flex: 1, minWidth: 0 })}>
                        <h1
                            className={css({
                                fontSize: { base: 'xl', md: '2xl' },
                                fontWeight: '700',
                                color: 'text',
                                mb: '1',
                            })}
                        >
                            {profile.name}
                        </h1>
                        {profile.username && (
                            <p className={css({ fontSize: '13px', color: 'textMuted' })}>@{profile.username}</p>
                        )}
                    </div>
                </div>
            )}

            {error && (
                <div
                    className={css({
                        padding: '10px 14px',
                        bg: 'errorBg',
                        color: 'errorText',
                        borderRadius: '8px',
                        mb: '3',
                        fontSize: '13px',
                    })}
                >
                    {error}
                </div>
            )}

            {/* 作成したワールド */}
            <section>
                <div
                    className={css({
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: '3',
                        flexWrap: 'wrap',
                        gap: '2',
                    })}
                >
                    <h2
                        className={css({
                            fontSize: 'lg',
                            fontWeight: '700',
                            color: 'text',
                        })}
                    >
                        作成したワールド
                        {isOwnPage && (
                            <span
                                className={css({
                                    ml: '2',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    color: 'textMuted',
                                })}
                            >
                                {worlds.length} / {LIMITS.MAX_WORLDS_PER_USER}
                            </span>
                        )}
                    </h2>
                    {isOwnPage && (
                        <button
                            type="button"
                            onClick={() => navigate('/worlds/new')}
                            disabled={!canCreate}
                            title={canCreate ? undefined : `上限 ${LIMITS.MAX_WORLDS_PER_USER} 個に達しています`}
                            className={css({
                                padding: '8px 16px',
                                bg: 'primary',
                                color: 'textOnPrimary',
                                border: 'none',
                                borderRadius: '10px',
                                fontSize: '13px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                                _hover: { opacity: 0.9 },
                            })}
                        >
                            + 新規作成
                        </button>
                    )}
                </div>

                {worlds.length === 0 ? (
                    <div
                        className={css({
                            textAlign: 'center',
                            padding: '40px 20px',
                            bg: 'surface',
                            borderRadius: '12px',
                            color: 'textMuted',
                            fontSize: '14px',
                        })}
                    >
                        まだワールドがありません
                    </div>
                ) : (
                    <div
                        className={css({
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                            gap: '4',
                        })}
                    >
                        {worlds.map((w) => (
                            <OwnedWorldCard
                                key={w.id}
                                world={w}
                                editable={isOwnPage}
                                onEdit={() => navigate(`/world/${w.id}/edit`)}
                                onOpen={() => navigate(`/world/${w.id}`)}
                            />
                        ))}
                        {/* 空きスロット可視化（自分のみ） */}
                        {isOwnPage &&
                            Array.from({ length: remaining }).map((_, i) => (
                                <button
                                    type="button"
                                    key={`empty-${i}`}
                                    onClick={() => navigate('/worlds/new')}
                                    className={css({
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        minH: '180px',
                                        bg: 'transparent',
                                        border: '2px dashed',
                                        borderColor: 'border',
                                        borderRadius: '14px',
                                        color: 'textSubtle',
                                        cursor: 'pointer',
                                        gap: '8px',
                                        _hover: {
                                            borderColor: 'primary',
                                            color: 'primary',
                                        },
                                    })}
                                >
                                    <svg
                                        width="28"
                                        height="28"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                    >
                                        <path d="M12 5v14M5 12h14" />
                                    </svg>
                                    <span className={css({ fontSize: '13px' })}>空きスロット</span>
                                </button>
                            ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function OwnedWorldCard({
    world,
    editable,
    onEdit,
    onOpen,
}: {
    world: OwnedWorld;
    editable: boolean;
    onEdit: () => void;
    onOpen: () => void;
}) {
    return (
        <div
            className={css({
                display: 'flex',
                flexDirection: 'column',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '14px',
                overflow: 'hidden',
                transition: 'border-color 0.16s ease',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            <button
                type="button"
                onClick={onOpen}
                className={css({
                    display: 'block',
                    width: '100%',
                    height: '100px',
                    bg: 'secondary',
                    border: 'none',
                    p: 0,
                    cursor: 'pointer',
                    overflow: 'hidden',
                })}
            >
                {world.thumbnail ? (
                    <img
                        src={world.thumbnail}
                        alt={world.displayName}
                        className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                    />
                ) : (
                    <div
                        className={css({
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'textSubtle',
                        })}
                    >
                        <svg
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                    </div>
                )}
            </button>
            <div className={css({ p: '3', display: 'flex', flexDirection: 'column', gap: '2', flex: 1 })}>
                <h3 className={css({ fontSize: '15px', fontWeight: '600', color: 'text' })}>{world.displayName}</h3>
                {world.description && (
                    <p
                        className={css({
                            fontSize: '12px',
                            color: 'textMuted',
                            lineHeight: '1.4',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            overflow: 'hidden',
                        })}
                        style={{ WebkitBoxOrient: 'vertical' }}
                    >
                        {world.description}
                    </p>
                )}
                <div
                    className={css({ display: 'flex', gap: '8px', fontSize: '11px', color: 'textSubtle', mt: 'auto' })}
                >
                    <span>
                        {world.capacity.default}〜{world.capacity.max}人
                    </span>
                    <span>v{world.version}</span>
                </div>
                {editable && (
                    <button
                        type="button"
                        onClick={onEdit}
                        className={css({
                            mt: '2',
                            padding: '6px 12px',
                            bg: 'primary',
                            color: 'textOnPrimary',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            _hover: { opacity: 0.9 },
                        })}
                    >
                        編集
                    </button>
                )}
            </div>
        </div>
    );
}
