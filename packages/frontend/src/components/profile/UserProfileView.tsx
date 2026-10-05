import { displayAuthorAccount } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { WorldDetailModal } from '@/components/lobby/WorldDetailModal';
import { UserSocialBar } from '@/components/social';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/session';
import { css, cva } from '@/styled-system/css';
import { BioSection } from './BioSection';
import { FavoriteWorldsSection } from './FavoriteWorldsSection';
import { type OwnedWorld, OwnedWorldCard } from './OwnedWorldCard';

/** 公開プロフィール（`GET /api/v1/users/:id`）。 */
interface PublicProfile {
    id: string;
    name: string;
    handle: string | null;
    author: string | null;
    profileImageUrl: string | null;
    bio?: string | null;
}

const actionButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1.5',
        px: '3',
        py: '1.5',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { opacity: 0.9 } },
            secondary: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
        },
    },
});

interface UserProfileViewProps {
    /** 表示対象のユーザーID。省略時はログイン中の自分 */
    userId?: string;
    /** 画面遷移の直前に呼ばれる（オーバーレイを閉じる等） */
    onNavigate?: () => void;
    /** インスタンス参加ハンドラ（HUDから開いた場合に使用） */
    onJoinInstance?: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
    /** 自分のプロフィールの「プロフィールを編集」（設定のプロフィールを開く）。省略時はボタンを出さない */
    onEditProfile?: () => void;
}

/**
 * プロフィール（ほかの人に見えるとおり。自分のページでも同じ内容）。ページ（/@ID・/user/:id）と HUD のマイページで使う。
 * 自分のページには「プロフィールを編集」を出す（編集は設定で行う）。共有はページの URL（/@ID）をそのまま使う。
 */
export function UserProfileView({ userId, onNavigate, onJoinInstance, onEditProfile }: UserProfileViewProps) {
    const navigate = useNavigate();
    const { data: session, isPending } = useSession();
    const targetUserId = userId ?? session?.user.id;
    const isOwnPage = !!session && targetUserId === session.user.id;

    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [worlds, setWorlds] = useState<OwnedWorld[]>([]);
    const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const joinInstance = (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => {
        if (onJoinInstance) {
            onJoinInstance(instanceId, worldId, worldData);
        } else {
            onNavigate?.();
            navigate(`/instance/${instanceId}`, { state: { worldId } });
        }
    };

    useEffect(() => {
        if (isPending || !targetUserId) return;
        const ctrl = { cancelled: false };
        setLoading(true);
        setError('');
        const id = encodeURIComponent(targetUserId);
        Promise.all([
            fetch(`${API_BASE}/api/v1/users/${id}`, { credentials: 'include' }),
            fetch(`${API_BASE}/api/v1/users/${id}/worlds`, { credentials: 'include' }),
        ])
            .then(async ([pRes, wRes]) => {
                if (!pRes.ok) throw new Error(`プロフィール取得失敗 (${pRes.status})`);
                if (!wRes.ok) throw new Error(`ワールド取得失敗 (${wRes.status})`);
                const [p, w] = [(await pRes.json()) as PublicProfile, (await wRes.json()) as { worlds: OwnedWorld[] }];
                if (ctrl.cancelled) return;
                setProfile(p);
                setWorlds(w.worlds);
            })
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込み失敗'))
            .finally(() => !ctrl.cancelled && setLoading(false));
        return () => {
            ctrl.cancelled = true;
        };
    }, [isPending, targetUserId]);

    if (isPending || loading) {
        return (
            <div className={css({ display: 'flex', justifyContent: 'center', p: '10', color: 'textMuted' })}>
                読み込み中...
            </div>
        );
    }

    const selectedWorld = worlds.find((w) => w.id === selectedWorldId);

    return (
        <div>
            {profile && (
                <div
                    className={css({
                        bg: 'surface',
                        borderRadius: '16px',
                        p: { base: '4', md: '6' },
                        mb: '4',
                        display: 'flex',
                        alignItems: 'flex-start',
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
                        <div className={css({ display: 'flex', alignItems: 'flex-start', gap: '3', flexWrap: 'wrap' })}>
                            <div className={css({ flex: 1, minWidth: '160px' })}>
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
                                {profile.author && (
                                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                                        {displayAuthorAccount(profile.author)}
                                    </p>
                                )}
                            </div>
                            {isOwnPage && (
                                <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                                    {onEditProfile && (
                                        <button
                                            type="button"
                                            className={actionButton({ tone: 'primary' })}
                                            onClick={onEditProfile}
                                        >
                                            プロフィールを編集
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        <BioSection bio={profile.bio ?? null} editable={false} onChanged={() => undefined} />
                    </div>
                </div>
            )}

            {!isOwnPage && session && profile && <UserSocialBar userId={profile.id} name={profile.name} />}

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

            <section>
                <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '3' })}>作成したワールド</h2>
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
                                editable={false}
                                onEdit={() => undefined}
                                onOpen={() => setSelectedWorldId(w.id)}
                            />
                        ))}
                    </div>
                )}
            </section>

            {targetUserId && (
                <FavoriteWorldsSection userId={targetUserId} isOwnPage={false} onJoinInstance={joinInstance} />
            )}

            {selectedWorld && (
                <WorldDetailModal
                    worldId={selectedWorld.id}
                    initialWorld={{
                        ...selectedWorld,
                        description: selectedWorld.description ?? undefined,
                        thumbnail: selectedWorld.thumbnail ?? undefined,
                        authorId: profile?.id,
                    }}
                    onClose={() => setSelectedWorldId(null)}
                    onJoinInstance={joinInstance}
                />
            )}
        </div>
    );
}
