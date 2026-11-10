import { isRemoteUserId, type PublishedMod, type UserProfile } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ProfileLocationCard } from '@/components/social';
import { OwnedWorldCard } from '@/components/worlds/OwnedWorldCard';
import { WorldDetailModal } from '@/components/worlds/WorldDetailModal';
import { fetchMyAccount, type MyAccount } from '@/lib/account/me';
import { fetchPublishedMods } from '@/lib/externalWorksApi';
import { fetchUserWorlds, type OwnedWorld } from '@/lib/profile/profileApi';
import { useSession } from '@/lib/session';
import { fetchUserWithFriendship } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { FavoriteWorldsSection } from './FavoriteWorldsSection';
import { ProfileEditor } from './ProfileEditor';
import { ProfileHeader } from './ProfileHeader';
import { ProfileRelationActions, ProfileRelationBadges } from './ProfileRelation';
import { PublishedModsSection } from './PublishedModsSection';
import { useProfileRelation } from './useProfileRelation';
import type { UserRelationSource } from './userRelation';

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
    // 自分の表示名がほかの人と同じになっている（編集で変えてもらう）
    const [nameConflict, setNameConflict] = useState(false);
    // プロフィールと一緒に取った自分との関係（関係のためだけに取り直さない）
    const [relationSource, setRelationSource] = useState<UserRelationSource | null>(null);
    const relation = useProfileRelation(
        !isOwnPage && session ? relationSource : null,
        profile && { id: profile.id, name: profile.name },
    );

    useEffect(() => {
        if (!isOwnPage) return;
        const ctrl = { cancelled: false };
        fetchMyAccount()
            .then((account) => !ctrl.cancelled && setNameConflict(account.displayNameConflict))
            .catch(() => undefined);
        return () => {
            ctrl.cancelled = true;
        };
    }, [isOwnPage]);

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
        // ほかのサーバーの人: プロフィールはこのサーバーが問い合わせたもの。ワールド・mod・お気に入りは相手のサーバーにある
        const remoteUser = isRemoteUserId(targetUserId);
        Promise.all([
            fetchUserWithFriendship(targetUserId),
            remoteUser ? [] : fetchUserWorlds(targetUserId),
            remoteUser ? [] : fetchPublishedMods(targetUserId),
        ])
            .then(([p, owned, publishedMods]) => {
                if (ctrl.cancelled) return;
                setProfile(p);
                setRelationSource(p);
                setWorlds(owned);
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
        if (latest.name !== profile?.name) setNameConflict(false);
    };

    if (isPending || loading) {
        return (
            <div className={css({ display: 'flex', justifyContent: 'center', p: '10', color: 'textMuted' })}>
                読み込み中...
            </div>
        );
    }

    const remote = !!targetUserId && isRemoteUserId(targetUserId);
    // 外部のワールドは本体のワールドと id が重なり得るので URL で区別する
    const keyOf = (w: OwnedWorld) => w.url ?? w.id;
    const selectedWorld = worlds.find((w) => keyOf(w) === selectedWorldKey);

    return (
        <div>
            {isOwnPage && nameConflict && edit.kind !== 'editing' && (
                <p role="alert" className={conflictNotice}>
                    ほかの人と同じ表示名になっています。「編集」から表示名を変えてください。
                </p>
            )}
            {/* 広い画面では、現在地を右に並べる（誰のプロフィールでも同じ形） */}
            <div className={top}>
                <div className={css({ flex: 1, minW: 0 })}>
                    {profile &&
                        (isOwnPage && edit.kind === 'editing' ? (
                            <ProfileEditor account={edit.account} onSaved={finishEditing} onCancel={finishEditing} />
                        ) : (
                            <ProfileHeader
                                profile={profile}
                                isOwner={isOwnPage}
                                onEdit={startEditing}
                                editPending={edit.kind === 'loading'}
                                relation={relation && <ProfileRelationBadges badges={relation.badges} />}
                                actions={
                                    relation &&
                                    relation.actions.length > 0 && (
                                        <ProfileRelationActions
                                            actions={relation.actions}
                                            busy={relation.busy}
                                            friendError={relation.friendError}
                                            onRun={(action) => void relation.run(action)}
                                        />
                                    )
                                }
                            />
                        ))}
                </div>
                {profile && <ProfileLocationCard userId={profile.id} self={isOwnPage} signedIn={!!session} />}
            </div>

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

            {!remote && (
                <section>
                    <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '3' })}>
                        作成したワールド
                    </h2>
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
            )}

            {mods.length > 0 && <PublishedModsSection mods={mods} />}

            {targetUserId && !remote && (
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

const top = css({
    display: 'flex',
    flexDirection: { base: 'column', lg: 'row' },
    alignItems: { lg: 'flex-start' },
    gap: { lg: '4' },
});

const conflictNotice = css({
    mb: '3',
    px: '3',
    py: '2',
    borderRadius: '10px',
    border: '1px solid',
    borderColor: 'errorText',
    color: 'errorText',
    fontSize: '13px',
    lineHeight: '1.6',
});
