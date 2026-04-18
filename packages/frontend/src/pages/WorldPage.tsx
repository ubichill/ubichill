import type { Instance, WorldListItem } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';

/**
 * ワールド詳細ページ (/world/:worldId)
 * URL 直アクセス対応。認証後に当ページへ戻るリダイレクトを保持する。
 * ソケット接続は行わない。
 */
export function WorldPage() {
    const navigate = useNavigate();
    const { worldId } = useParams<{ worldId: string }>();
    const { data: session, isPending } = useSession();

    const [world, setWorld] = useState<WorldListItem | null>(null);
    const [instances, setInstances] = useState<Instance[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isPending) return;
        if (!session) {
            navigate('/auth', { state: { from: `/world/${worldId}` }, replace: true });
            return;
        }
        if (!worldId) return;

        setLoading(true);
        setError(null);

        Promise.all([
            fetch(`${API_BASE}/api/v1/worlds/${worldId}`, { credentials: 'include' }).then((r) => {
                if (!r.ok) throw new Error('World not found');
                return r.json() as Promise<WorldListItem>;
            }),
            fetch(`${API_BASE}/api/v1/instances?worldId=${encodeURIComponent(worldId)}`, {
                credentials: 'include',
            }).then((r) => r.json() as Promise<{ instances: Instance[] }>),
        ])
            .then(([worldData, instancesData]) => {
                setWorld(worldData);
                setInstances(instancesData.instances ?? []);
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'データの取得に失敗しました'))
            .finally(() => setLoading(false));
    }, [isPending, session, worldId, navigate]);

    const handleJoin = (instanceId: string) => {
        navigate(`/instance/${instanceId}`, { state: { worldId } });
    };

    const handleCreate = async () => {
        if (!worldId || creating) return;
        setCreating(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/v1/instances`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ worldId }),
            });
            if (!res.ok) {
                const data = (await res.json()) as { error?: string };
                throw new Error(data.error ?? 'インスタンスの作成に失敗しました');
            }
            const instance = (await res.json()) as Instance;
            navigate(`/instance/${instance.id}`, { state: { worldId } });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'インスタンスの作成に失敗しました');
        } finally {
            setCreating(false);
        }
    };

    if (isPending || loading) {
        return (
            <div className={css({ minH: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <p className={css({ color: 'textMuted' })}>読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div
                className={css({
                    minH: '100vh',
                    display: 'flex',
                    flexDir: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                })}
            >
                <p className={css({ color: 'errorText' })}>{error}</p>
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className={css({
                        px: 6,
                        py: 3,
                        bg: 'secondary',
                        color: 'textMuted',
                        borderRadius: 'md',
                        cursor: 'pointer',
                        border: 'none',
                    })}
                >
                    ロビーへ
                </button>
            </div>
        );
    }

    return (
        <div
            className={css({
                minH: '100vh',
                display: 'flex',
                flexDir: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                p: 8,
            })}
        >
            {world?.thumbnail && (
                <img
                    src={world.thumbnail}
                    alt={world.displayName}
                    className={css({
                        width: '100%',
                        maxW: 'sm',
                        height: '160px',
                        objectFit: 'cover',
                        borderRadius: 'xl',
                    })}
                />
            )}
            <h1 className={css({ fontSize: '2xl', fontWeight: '700', color: 'text' })}>
                {world?.displayName ?? worldId}
            </h1>
            {world?.description && (
                <p className={css({ color: 'textMuted', fontSize: 'sm', textAlign: 'center', maxW: 'sm' })}>
                    {world.description}
                </p>
            )}

            {instances.length > 0 && (
                <div className={css({ display: 'flex', flexDir: 'column', gap: 3, width: 'full', maxW: 'sm' })}>
                    {instances.map((i) => (
                        <button
                            key={i.id}
                            type="button"
                            onClick={() => handleJoin(i.id)}
                            className={css({
                                p: 4,
                                bg: 'surfaceAccent',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: 'lg',
                                textAlign: 'left',
                                cursor: 'pointer',
                                _hover: { borderColor: 'primary' },
                            })}
                        >
                            <span className={css({ fontSize: 'sm', color: 'textMuted' })}>
                                参加者 {i.stats.currentUsers} / {i.stats.maxUsers}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {instances.length === 0 && (
                <p className={css({ color: 'textMuted', fontSize: 'sm' })}>参加可能なインスタンスがありません</p>
            )}

            <div className={css({ display: 'flex', gap: 3 })}>
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className={css({
                        px: 6,
                        py: 3,
                        bg: 'primary',
                        color: 'textOnPrimary',
                        borderRadius: 'md',
                        fontWeight: '600',
                        cursor: 'pointer',
                        border: 'none',
                        _disabled: { opacity: 0.6, cursor: 'not-allowed' },
                    })}
                >
                    {creating ? '作成中...' : '新しいインスタンスを作成'}
                </button>
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className={css({
                        px: 6,
                        py: 3,
                        bg: 'secondary',
                        color: 'textMuted',
                        borderRadius: 'md',
                        cursor: 'pointer',
                        border: 'none',
                    })}
                >
                    ロビーへ
                </button>
            </div>
        </div>
    );
}
