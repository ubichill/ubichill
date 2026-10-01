import { displayAuthorAccount, isPublishable, LIMITS, type WorldIdentity } from '@ubichill/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { WorldDetailModal } from '@/components/lobby/WorldDetailModal';
import { WorldIdentityBadge } from '@/components/lobby/WorldIdentityBadge';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { type ResignResult, resignAll } from '@/lib/account/resign';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/session';
import { authorSignerFor, browserFetch, signHostedWorld } from '@/lib/signing';
import { css } from '@/styled-system/css';
import { DisplayNameEditor } from './DisplayNameEditor';
import { FavoriteWorldsSection } from './FavoriteWorldsSection';
import { PasswordSection } from './PasswordSection';
import { PublishingSection } from './PublishingSection';

/** 公開プロフィール。自分のページでは MyAccount の項目（公開環境の鍵など）も入る。 */
interface UserProfile {
    id: string;
    name: string;
    handle: string | null;
    author: string | null;
    signingKeys?: string[];
    displayNameConflict?: boolean;
    passwordChangeRequired?: boolean;
    passwordManagedBySecret?: boolean;
    isAdmin?: boolean;
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
    /** 本人の一覧のみ。署名なしは非公開なので「署名して公開」を出す。 */
    identity?: WorldIdentity;
}

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

/**
 * ユーザープロフィール本体。ページ（UserPage）と HUD のマイページタブ（HudTabs）で共通利用する。
 */
export function UserProfileView({ userId, onNavigate, onJoinInstance }: UserProfileViewProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { data: session, isPending } = useSession();

    const isMe = !userId;
    const targetUserId = isMe ? session?.user.id : userId;
    const isOwnPage = !!session && targetUserId === session.user.id;

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [environmentsVersion, setEnvironmentsVersion] = useState(0);
    const [worlds, setWorlds] = useState<OwnedWorld[]>([]);
    const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const selectedWorld = useMemo(() => worlds.find((w) => w.id === selectedWorldId), [worlds, selectedWorldId]);

    /** 自分のワールドの一覧を読み込み直す（公開環境の取り消しで作者表示が変わったとき）。 */
    const reloadMyWorlds = async () => {
        const res = await fetch(`${API_BASE}/api/v1/users/me/worlds`, { credentials: 'include' });
        if (res.ok) setWorlds(((await res.json()) as { worlds: OwnedWorld[] }).worlds);
    };

    const joinInstance = (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => {
        if (onJoinInstance) {
            onJoinInstance(instanceId, worldId, worldData);
        } else {
            // もし onJoinInstance が渡されていなければ、フルページ遷移でインスタンスへ
            onNavigate?.();
            navigate(`/instance/${instanceId}`, { state: { worldId } });
        }
    };

    const go = async (path: string) => {
        if (!(await confirm('このページに移動しますか？'))) return;
        onNavigate?.();
        navigate(path);
    };

    useEffect(() => {
        if (isPending) return;
        if (!targetUserId) return;
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
    }, [isPending, targetUserId, isOwnPage]);

    if (isPending || loading) {
        return (
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: '10',
                    color: 'textMuted',
                })}
            >
                読み込み中...
            </div>
        );
    }

    const remaining = Math.max(0, LIMITS.MAX_WORLDS_PER_USER - worlds.length);
    const unsignedCount = isOwnPage ? worlds.filter((w) => !isPublishable(w.identity)).length : 0;

    // 保存し直さなくても、今の内容に作者アカウントで署名して公開できるようにする（鍵の用意・登録は自動）。
    // 取り消した鍵で署名したワールドをまとめて署名し直すときも同じ処理を使う（鍵の用意は 1 回だけ）。
    const signWorlds = async (worldIds: readonly string[]): Promise<ResignResult<WorldIdentity>> => {
        setError('');
        if (!profile?.author) {
            setError('公開するには、上の「公開」で ID を設定してください。');
            return { done: [], failed: worldIds.map((id) => ({ id, error: 'ID が未設定です' })) };
        }
        try {
            const signingKeys = profile.signingKeys ?? [];
            const signer = await authorSignerFor({ id: profile.id, author: profile.author, signingKeys });
            if (!signingKeys.includes(signer.key.publicKey)) {
                setProfile({ ...profile, signingKeys: [...signingKeys, signer.key.publicKey] });
                setEnvironmentsVersion((v) => v + 1);
            }
            const result = await resignAll(worldIds, (worldId) =>
                signHostedWorld(worldId, signer, { apiBase: API_BASE, fetch: browserFetch }),
            );
            const signed = new Map(result.done.map((d) => [d.id, d.identity]));
            setWorlds((prev) => prev.map((w) => (signed.has(w.id) ? { ...w, identity: signed.get(w.id) } : w)));
            if (worldIds.length === 1 && result.failed[0]) setError(result.failed[0].error);
            return result;
        } catch (e) {
            const message = e instanceof Error ? e.message : '署名に失敗しました';
            setError(message);
            return { done: [], failed: worldIds.map((id) => ({ id, error: message })) };
        }
    };
    const canCreate = isOwnPage && remaining > 0;

    return (
        <div>
            {/* プロフィールカード */}
            {profile && (
                <div
                    className={css({
                        bg: 'surface',
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
                        {profile.author && (
                            <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                                {displayAuthorAccount(profile.author)}
                            </p>
                        )}
                        {isOwnPage && (
                            <DisplayNameEditor
                                name={profile.name}
                                conflict={!!profile.displayNameConflict}
                                onChanged={(name) => setProfile({ ...profile, name, displayNameConflict: false })}
                            />
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

            {isOwnPage && profile && (
                <PasswordSection
                    required={!!profile.passwordChangeRequired}
                    managedBySecret={!!profile.passwordManagedBySecret}
                    onChanged={() => setProfile({ ...profile, passwordChangeRequired: false })}
                />
            )}
            {isOwnPage && profile && (
                <PublishingSection
                    account={{
                        ...profile,
                        signingKeys: profile.signingKeys ?? [],
                        displayNameConflict: !!profile.displayNameConflict,
                        passwordChangeRequired: !!profile.passwordChangeRequired,
                        passwordManagedBySecret: !!profile.passwordManagedBySecret,
                        isAdmin: !!profile.isAdmin,
                    }}
                    onAccountChange={setProfile}
                    unsignedCount={unsignedCount}
                    worlds={worlds}
                    onResign={signWorlds}
                    onRevoked={reloadMyWorlds}
                    refreshKey={environmentsVersion}
                />
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
                            onClick={() => go('/worlds/new')}
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
                                onEdit={() => go(`/world/${w.id}/edit`)}
                                onSign={
                                    // 署名済みで作者を確認できないワールド（取り消した鍵など）は、上の「公開」欄から署名し直す。
                                    // 漏えいした環境の署名は中身を確かめさせるため、ここでは 1 クリックで署名し直させない
                                    isOwnPage && !isPublishable(w.identity) && w.identity?.status !== 'verified'
                                        ? async () => void (await signWorlds([w.id]))
                                        : undefined
                                }
                                onOpen={() => setSelectedWorldId(w.id)}
                                onDelete={
                                    isOwnPage
                                        ? async () => {
                                              if (!(await confirm(`「${w.displayName}」を削除しますか?`))) return;
                                              const res = await fetch(`${API_BASE}/api/v1/worlds/${w.id}`, {
                                                  method: 'DELETE',
                                                  credentials: 'include',
                                              });
                                              if (!res.ok) {
                                                  setError(`削除に失敗しました (${res.status})`);
                                                  return;
                                              }
                                              setWorlds((prev) => prev.filter((x) => x.id !== w.id));
                                          }
                                        : undefined
                                }
                            />
                        ))}
                        {/* 空きスロット可視化（自分のみ） */}
                        {isOwnPage &&
                            Array.from({ length: remaining }).map((_, i) => (
                                <button
                                    type="button"
                                    key={`empty-${i}`}
                                    onClick={() => go('/worlds/new')}
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

            {targetUserId && (
                <FavoriteWorldsSection userId={targetUserId} isOwnPage={isOwnPage} onJoinInstance={joinInstance} />
            )}

            {selectedWorldId && selectedWorld && (
                <WorldDetailModal
                    worldId={selectedWorldId}
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

function OwnedWorldCard({
    world,
    editable,
    onEdit,
    onOpen,
    onDelete,
    onSign,
}: {
    world: OwnedWorld;
    editable: boolean;
    onEdit: () => void;
    onOpen: () => void;
    onDelete?: () => void;
    onSign?: () => Promise<void>;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [signing, setSigning] = useState(false);

    // メニュー外クリックで閉じる
    useEffect(() => {
        if (!menuOpen) return;
        const close = () => setMenuOpen(false);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [menuOpen]);

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
                position: 'relative',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            {onDelete && (
                <div
                    className={css({
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        zIndex: 1,
                    })}
                >
                    <button
                        type="button"
                        aria-label="メニュー"
                        title="メニュー"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen((p) => !p);
                        }}
                        className={css({
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bg: 'rgba(0,0,0,0.45)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            _hover: { bg: 'rgba(0,0,0,0.6)' },
                        })}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                        </svg>
                    </button>
                    {menuOpen && (
                        <div
                            className={css({
                                position: 'absolute',
                                top: '34px',
                                right: '0',
                                minWidth: '120px',
                                bg: 'surface',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                                overflow: 'hidden',
                            })}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setMenuOpen(false);
                                    onDelete();
                                }}
                                className={css({
                                    width: '100%',
                                    padding: '8px 12px',
                                    bg: 'transparent',
                                    border: 'none',
                                    color: 'errorText',
                                    fontSize: '13px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    _hover: { bg: 'errorBg' },
                                })}
                            >
                                削除
                            </button>
                        </div>
                    )}
                </div>
            )}
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
                    {editable && <WorldIdentityBadge identity={world.identity} />}
                </div>
                {editable && !onSign && world.identity?.status === 'verified' && !world.identity.author && (
                    <p className={css({ fontSize: '11px', color: 'textMuted', lineHeight: '1.4' })}>
                        作者を確認できない鍵（取り消し済みなど）で署名されているため、一覧に公開されていません。上の「公開」欄から署名し直せます
                    </p>
                )}
                {onSign && (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                        <p className={css({ fontSize: '11px', color: 'textMuted', lineHeight: '1.4' })}>
                            署名がないため一覧に公開されていません
                        </p>
                        <button
                            type="button"
                            disabled={signing}
                            onClick={async () => {
                                setSigning(true);
                                await onSign();
                                setSigning(false);
                            }}
                            className={css({
                                padding: '6px 12px',
                                bg: 'surface',
                                color: 'text',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                _hover: { bg: 'surfaceHover' },
                                _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                            })}
                        >
                            {signing ? '署名中…' : '署名して公開'}
                        </button>
                    </div>
                )}
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
