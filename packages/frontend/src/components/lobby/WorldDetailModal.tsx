import { type Instance, type WorldListItem, worldShareUrl, worldSourceLabel } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';
import { InstanceCard } from './InstanceCard';
import { InstanceDetailOverlay } from './InstanceDetailOverlay';

interface WorldDetailModalProps {
    worldId: string;
    onClose: () => void;
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
    currentInstanceId?: string;
    initialWorld?: Partial<WorldListItem> & { id: string; displayName: string; authorId?: string };
}

export function WorldDetailModal({
    worldId,
    onClose,
    onJoinInstance,
    currentInstanceId,
    initialWorld,
}: WorldDetailModalProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { data: session } = useSession();
    const [world, setWorld] = useState<Partial<WorldListItem> | null>(initialWorld ?? null);
    const [instances, setInstances] = useState<Instance[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [detailInstance, setDetailInstance] = useState<Instance | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const fetchWorld = initialWorld
            ? Promise.resolve(initialWorld)
            : fetch(`${API_BASE}/api/v1/worlds/${worldId}`, { credentials: 'include' }).then((r) => {
                  if (!r.ok) throw new Error('World not found');
                  return r.json() as Promise<WorldListItem>;
              });

        const worldRef = initialWorld?.url ?? worldId;
        Promise.all([
            fetchWorld,
            fetch(`${API_BASE}/api/v1/instances?worldId=${encodeURIComponent(worldRef)}`, {
                credentials: 'include',
            }).then((r) => r.json() as Promise<{ instances: Instance[] }>),
        ])
            .then(([worldData, instancesData]) => {
                if (cancelled) return;
                setWorld(worldData);
                setInstances(instancesData.instances ?? []);
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : 'データの取得に失敗しました');
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [worldId, initialWorld]);

    const handleCreate = async () => {
        if (creating) return;
        setCreating(true);
        setError(null);
        const worldRef = world?.url ?? worldId;
        try {
            const res = await fetch(`${API_BASE}/api/v1/instances`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ worldId: worldRef }),
            });
            if (!res.ok) {
                const data = (await res.json()) as { error?: string };
                throw new Error(data.error ?? 'インスタンスの作成に失敗しました');
            }
            const instance = (await res.json()) as Instance;
            onJoinInstance(instance.id, instance.world.id, {
                thumbnail: instance.world.thumbnail,
                displayName: instance.world.displayName,
            });
            onClose();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'インスタンスの作成に失敗しました');
        } finally {
            setCreating(false);
        }
    };

    const handleCopyUrl = () => {
        // ユーザーに配る共有 URL（.../world/:id）。canonical(機械URL) からも共有形へ変換。
        // リモートワールドは origin サーバーの共有 URL になる。無ければ自ホストにフォールバック。
        const url = world?.url ? worldShareUrl(world.url) : `${window.location.origin}/world/${worldId}`;
        void navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            <div
                className={css({
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    bg: 'rgba(0, 0, 0, 0.4)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 2000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: { base: '4', md: '8' },
                })}
                onClick={onClose}
            >
                <div
                    className={css({
                        bg: 'surface',
                        width: '100%',
                        maxWidth: '500px',
                        maxHeight: '100%',
                        borderRadius: '24px',
                        boxShadow: 'modal',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    })}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={css({ p: '4', overflowY: 'auto', flex: 1 })}>
                        {loading ? (
                            <div className={css({ textAlign: 'center', py: '10', color: 'textMuted' })}>
                                読み込み中...
                            </div>
                        ) : error ? (
                            <div className={css({ color: 'errorText', bg: 'errorBg', p: '4', borderRadius: '12px' })}>
                                {error}
                            </div>
                        ) : (
                            <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                                {world?.thumbnail && (
                                    <img
                                        src={world.thumbnail}
                                        alt={world.displayName}
                                        className={css({
                                            width: '100%',
                                            height: '200px',
                                            objectFit: 'cover',
                                            borderRadius: '16px',
                                        })}
                                    />
                                )}
                                <div>
                                    {/* ワールド名クリックで詳細ページ(/world/:id)へ遷移 */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate(`/world/${world?.id ?? worldId}`);
                                            onClose();
                                        }}
                                        className={css({
                                            display: 'block',
                                            textAlign: 'left',
                                            bg: 'transparent',
                                            border: 'none',
                                            p: 0,
                                            cursor: 'pointer',
                                            fontSize: 'xl',
                                            fontWeight: 'bold',
                                            color: 'text',
                                            mb: '1',
                                            _hover: { textDecoration: 'underline' },
                                        })}
                                    >
                                        {world?.displayName ?? worldId}
                                    </button>
                                    {world?.description && (
                                        <p className={css({ color: 'textMuted', fontSize: 'sm', lineHeight: '1.5' })}>
                                            {world.description}
                                        </p>
                                    )}
                                    {world?.source && (
                                        <span
                                            className={css({
                                                display: 'inline-block',
                                                mt: '2',
                                                px: '6px',
                                                py: '2px',
                                                bg: 'primarySubtle',
                                                borderRadius: '4px',
                                                fontSize: '11px',
                                                color: 'textMuted',
                                            })}
                                            title={world.source.originInstance ?? world.source.url}
                                        >
                                            {worldSourceLabel(world.source)}
                                        </span>
                                    )}
                                </div>

                                <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                                    <button
                                        type="button"
                                        onClick={handleCopyUrl}
                                        className={css({
                                            flex: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '2',
                                            py: '2',
                                            px: '3',
                                            bg: 'secondary',
                                            color: 'text',
                                            border: '1px solid',
                                            borderColor: 'border',
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            _hover: { borderColor: 'borderStrong' },
                                        })}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        >
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                        </svg>
                                        {copied ? 'コピーしました！' : '共有URLをコピー'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCreate}
                                        disabled={creating}
                                        className={css({
                                            flex: 1,
                                            py: '2',
                                            px: '3',
                                            bg: 'primary',
                                            color: 'textOnPrimary',
                                            border: 'none',
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            _hover: { opacity: 0.9 },
                                            _disabled: { opacity: 0.6, cursor: 'not-allowed' },
                                        })}
                                    >
                                        {creating ? '作成中...' : '新しくインスタンス作成'}
                                    </button>
                                    {session && world?.authorId === session.user.id && (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (await confirm('ワールドの編集画面に移動しますか？')) {
                                                    navigate(`/world/${world.id}/edit`);
                                                    onClose();
                                                }
                                            }}
                                            className={css({
                                                flex: '0 0 auto',
                                                py: '2',
                                                px: '4',
                                                bg: 'warning',
                                                color: 'primary',
                                                border: 'none',
                                                borderRadius: '10px',
                                                fontSize: '13px',
                                                fontWeight: '600',
                                                cursor: 'pointer',
                                                _hover: { opacity: 0.9 },
                                            })}
                                        >
                                            編集
                                        </button>
                                    )}
                                </div>

                                <div>
                                    <h3 className={css({ fontSize: 'md', fontWeight: 'bold', color: 'text', mb: '3' })}>
                                        アクティブなインスタンス
                                    </h3>
                                    {instances.length === 0 ? (
                                        <p
                                            className={css({
                                                color: 'textMuted',
                                                fontSize: 'sm',
                                                textAlign: 'center',
                                                py: '4',
                                                bg: 'secondary',
                                                borderRadius: '12px',
                                            })}
                                        >
                                            参加可能なインスタンスがありません
                                        </p>
                                    ) : (
                                        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                                            {instances.map((i) => (
                                                <InstanceCard
                                                    key={i.id}
                                                    instance={i}
                                                    isCurrent={i.id === currentInstanceId}
                                                    onOpenDetail={() => setDetailInstance(i)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {detailInstance && (
                <InstanceDetailOverlay
                    instance={detailInstance}
                    isCurrent={detailInstance.id === currentInstanceId}
                    onClose={() => setDetailInstance(null)}
                    onJoin={(id) => {
                        onJoinInstance(id, detailInstance.world.id, {
                            thumbnail: detailInstance.world.thumbnail,
                            displayName: detailInstance.world.displayName,
                        });
                        setDetailInstance(null);
                        onClose();
                    }}
                />
            )}
        </>
    );
}
