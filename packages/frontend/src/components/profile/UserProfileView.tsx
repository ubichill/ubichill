import type { PublishedMod, UserProfile } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { WorldDetailModal } from '@/components/lobby/WorldDetailModal';
import { UserSocialBar } from '@/components/social';
import { fetchMyAccount, type MyAccount } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import { fetchPublishedMods } from '@/lib/externalWorksApi';
import { fetchUserProfile } from '@/lib/profile/profileApi';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';
import { FavoriteWorldsSection } from './FavoriteWorldsSection';
import { type OwnedWorld, OwnedWorldCard } from './OwnedWorldCard';
import { ProfileEditor } from './ProfileEditor';
import { ProfileHeader } from './ProfileHeader';
import { PublishedModsSection } from './PublishedModsSection';

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
}

type EditState = { kind: 'viewing' } | { kind: 'loading' } | { kind: 'editing'; account: MyAccount };

/**
 * プロフィール（ほかの人に見えるとおり。自分のページでも同じ内容）。ページ（/@ID・/user/:id）と HUD のマイページで使う。
 * 自分のページでは「編集」で同じ場所が編集の表示に変わる。共有はページの URL（/@ID）。
 */
export function UserProfileView({ userId, onNavigate, onJoinInstance }: UserProfileViewProps) {
    const navigate = useNavigate();
    const { data: session, isPending } = useSession();
    const targetUserId = userId ?? session?.user.id;
    const isOwnPage = !!session && targetUserId === session.user.id;

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [edit, setEdit] = useState<EditState>({ kind: 'viewing' });
    const [worlds, setWorlds] = useState<OwnedWorld[]>([]);
    const [selectedWorldKey, setSelectedWorldKey] = useState<string | null>(null);
    const [mods, setMods] = useState<PublishedMod[]>([]);
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
        setEdit({ kind: 'viewing' });
        Promise.all([
            fetchUserProfile(targetUserId),
            fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(targetUserId)}/worlds`, { credentials: 'include' }),
            fetchPublishedMods(targetUserId),
        ])
            .then(async ([p, wRes, publishedMods]) => {
                if (!wRes.ok) throw new Error(`ワールド取得失敗 (${wRes.status})`);
                const w = (await wRes.json()) as { worlds: OwnedWorld[] };
                if (ctrl.cancelled) return;
                setProfile(p);
                setWorlds(w.worlds);
                setMods(publishedMods);
            })
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込み失敗'))
            .finally(() => !ctrl.cancelled && setLoading(false));
        return () => {
            ctrl.cancelled = true;
        };
    }, [isPending, targetUserId]);

    // 編集は本人のアカウント（表示名の変更の制限などを含む）を読み直してから始める
    const startEditing = () => {
        setEdit({ kind: 'loading' });
        setError('');
        fetchMyAccount()
            .then((account) => setEdit({ kind: 'editing', account }))
            .catch((e: unknown) => {
                setEdit({ kind: 'viewing' });
                setError(e instanceof Error ? e.message : 'アカウントを読み込めませんでした');
            });
    };
    const finishEditing = (latest: UserProfile) => {
        setProfile(latest);
        setEdit({ kind: 'viewing' });
    };

    if (isPending || loading) {
        return (
            <div className={css({ display: 'flex', justifyContent: 'center', p: '10', color: 'textMuted' })}>
                読み込み中...
            </div>
        );
    }

    // 外部のワールドは本体のワールドと id が重なり得るので URL で区別する
    const keyOf = (w: OwnedWorld) => w.url ?? w.id;
    const selectedWorld = worlds.find((w) => keyOf(w) === selectedWorldKey);

    return (
        <div>
            {profile &&
                (isOwnPage && edit.kind === 'editing' ? (
                    <ProfileEditor account={edit.account} onSaved={finishEditing} onCancel={finishEditing} />
                ) : (
                    <ProfileHeader
                        profile={profile}
                        isOwner={isOwnPage}
                        onEdit={startEditing}
                        editPending={edit.kind === 'loading'}
                    />
                ))}

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
                            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
                            gap: '4',
                        })}
                    >
                        {worlds.map((w) => (
                            <OwnedWorldCard
                                key={keyOf(w)}
                                world={w}
                                editable={false}
                                onEdit={() => undefined}
                                onOpen={() => setSelectedWorldKey(keyOf(w))}
                            />
                        ))}
                    </div>
                )}
            </section>

            {mods.length > 0 && <PublishedModsSection mods={mods} />}

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
                    onClose={() => setSelectedWorldKey(null)}
                    onJoinInstance={joinInstance}
                />
            )}
        </div>
    );
}
