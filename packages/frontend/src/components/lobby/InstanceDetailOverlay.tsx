import { type Instance, type WorldListItem, worldOriginDomain } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';
import { useFavorites } from './useFavorites';

interface InstanceDetailOverlayProps {
    instance: Instance;
    onClose: () => void;
    /** インスタンスに入る（＝参加）。 */
    onJoin: (instanceId: string) => void;
    /** 現在参加中のインスタンスID（「参加中」表示・入る不可） */
    currentInstanceId?: string;
}

/**
 * インスタンス詳細のオーバーレイ。**ルート遷移せず**（インスタンス内で見たまま）開く。
 *
 * ワールドページと役割を分ける: こちらは「インスタンス固有」情報（人数・アクセス・入る）を
 * サムネ直下に優先表示し、ワールド情報（説明・mod）は副次に置く。
 * 右の他インスタンスを選ぶと、そのインスタンスの詳細に切り替わる（同ワールド内での回遊）。
 * 由来はローカルなら出さず、リモートのみ名前の下にドメインを出す。
 * mod/説明は instance.world から表示するのでリモートワールドでも見れる。
 */
export function InstanceDetailOverlay({ instance, onClose, onJoin, currentInstanceId }: InstanceDetailOverlayProps) {
    const worldRef = instance.world.source?.url ?? instance.world.id;
    // 詳細の主役インスタンス（右の一覧で切り替わる）。
    const [selected, setSelected] = useState<Instance>(instance);
    // instance.world（mods/description/source を含む）を初期値にし、ローカルはフル情報で補う。
    const [world, setWorld] = useState<Partial<WorldListItem>>(instance.world);
    const [siblings, setSiblings] = useState<Instance[]>([instance]);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { isFavorite, toggle: toggleFavorite } = useFavorites();

    useEffect(() => {
        let cancelled = false;
        void fetch(`${API_BASE}/api/v1/worlds/${encodeURIComponent(instance.world.id)}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<WorldListItem>) : null))
            .then((w) => {
                if (!cancelled && w) setWorld((prev) => ({ ...prev, ...w }));
            })
            .catch(() => undefined);
        void fetch(`${API_BASE}/api/v1/instances?worldId=${encodeURIComponent(worldRef)}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<{ instances: Instance[] }>) : null))
            .then((data) => {
                if (!cancelled && data?.instances?.length) {
                    setSiblings(data.instances);
                    // 主役インスタンスの最新 stats に追従する。
                    const fresh = data.instances.find((i) => i.id === instance.id);
                    if (fresh) setSelected(fresh);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [instance.id, instance.world.id, worldRef]);

    const handleCreate = async () => {
        if (creating) return;
        setCreating(true);
        setError(null);
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
            const created = (await res.json()) as Instance;
            onJoin(created.id);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'インスタンスの作成に失敗しました');
        } finally {
            setCreating(false);
        }
    };

    const favorited = isFavorite(worldRef);
    const originDomain = world.source ? worldOriginDomain(world.source) : null;
    const isCurrent = selected.id === currentInstanceId;
    const isFull = selected.status === 'full';
    const accessLabel = selected.access.type === 'public' ? '公開' : '限定';

    // ワールド情報は副次。由来はドメインで名前下に出すので detail 行からは除外。
    const worldRows: Array<{ label: string; value: string }> = [
        world.authorName ? { label: '作成者', value: world.authorName } : null,
        world.version ? { label: 'バージョン', value: `v${world.version}` } : null,
    ].filter((r): r is { label: string; value: string } => r !== null);

    return (
        <div
            role="presentation"
            onClick={onClose}
            className={css({
                position: 'fixed',
                inset: 0,
                bg: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 3000,
                p: '4',
            })}
        >
            <div
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                className={css({
                    width: 'full',
                    maxW: '3xl',
                    maxH: '90vh',
                    overflowY: 'auto',
                    bg: 'surface',
                    borderRadius: '16px',
                    border: '1px solid',
                    borderColor: 'border',
                    boxShadow: 'card',
                    display: 'grid',
                    gridTemplateColumns: { base: '1fr', md: '3fr 2fr' },
                })}
            >
                {/* 左: サムネ + インスタンス固有情報（優先）+ ワールド情報（副次） */}
                <div className={css({ display: 'flex', flexDir: 'column' })}>
                    <div
                        className={css({
                            width: 'full',
                            aspectRatio: '16 / 9',
                            bg: 'secondary',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        })}
                    >
                        {world.thumbnail ? (
                            <img
                                src={world.thumbnail}
                                alt={world.displayName}
                                className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                            />
                        ) : (
                            <span className={css({ color: 'textSubtle', fontSize: 'sm' })}>No thumbnail</span>
                        )}
                    </div>
                    <div className={css({ p: '5', display: 'flex', flexDir: 'column', gap: '4' })}>
                        <div>
                            <h2 className={css({ fontSize: 'lg', fontWeight: 'bold', color: 'text' })}>
                                {world.displayName}
                            </h2>
                            {originDomain && (
                                <p
                                    className={css({
                                        fontSize: 'xs',
                                        color: 'textSubtle',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1',
                                        mt: '0.5',
                                    })}
                                >
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        aria-hidden="true"
                                    >
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M2 12h20" />
                                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
                                    </svg>
                                    {originDomain}
                                </p>
                            )}
                        </div>

                        {/* インスタンス固有情報（優先） */}
                        <div
                            className={css({
                                display: 'flex',
                                flexDir: 'column',
                                gap: '2',
                                p: '3',
                                bg: 'secondary',
                                borderRadius: '10px',
                            })}
                        >
                            <div className={css({ display: 'flex', justifyContent: 'space-between', fontSize: 'sm' })}>
                                <span className={css({ color: 'textSubtle' })}>参加人数</span>
                                <span className={css({ color: 'text', fontWeight: '600' })}>
                                    {selected.stats.currentUsers} / {selected.stats.maxUsers} 人
                                </span>
                            </div>
                            <div className={css({ display: 'flex', justifyContent: 'space-between', fontSize: 'sm' })}>
                                <span className={css({ color: 'textSubtle' })}>アクセス</span>
                                <span className={css({ color: 'text' })}>
                                    {accessLabel}
                                    {selected.access.password ? ' · パスワードあり' : ''}
                                </span>
                            </div>
                            <div className={css({ display: 'flex', justifyContent: 'space-between', fontSize: 'sm' })}>
                                <span className={css({ color: 'textSubtle' })}>状態</span>
                                <span className={css({ color: 'text' })}>{isFull ? '満員' : '参加可能'}</span>
                            </div>
                        </div>

                        {isCurrent ? (
                            <div
                                className={css({
                                    py: '3',
                                    textAlign: 'center',
                                    color: 'success',
                                    fontWeight: '600',
                                    bg: 'secondary',
                                    borderRadius: '10px',
                                })}
                            >
                                このインスタンスに参加中
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onJoin(selected.id)}
                                disabled={isFull}
                                className={css({
                                    py: '3',
                                    bg: 'primary',
                                    color: 'textOnPrimary',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    _hover: { opacity: 0.9 },
                                    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                                })}
                            >
                                {isFull ? '満員' : 'このインスタンスに入る'}
                            </button>
                        )}

                        {/* ワールド情報（副次） */}
                        {(world.description || worldRows.length > 0 || (world.mods && world.mods.length > 0)) && (
                            <div
                                className={css({
                                    display: 'flex',
                                    flexDir: 'column',
                                    gap: '3',
                                    pt: '3',
                                    borderTop: '1px solid',
                                    borderColor: 'border',
                                })}
                            >
                                {world.description && (
                                    <p className={css({ color: 'textMuted', fontSize: 'sm', lineHeight: '1.6' })}>
                                        {world.description}
                                    </p>
                                )}
                                {worldRows.length > 0 && (
                                    <dl className={css({ display: 'flex', flexDir: 'column', gap: '2' })}>
                                        {worldRows.map((r) => (
                                            <div
                                                key={r.label}
                                                className={css({
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    fontSize: 'xs',
                                                })}
                                            >
                                                <dt className={css({ color: 'textSubtle' })}>{r.label}</dt>
                                                <dd className={css({ color: 'text', fontWeight: '500' })}>{r.value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                                {world.mods && world.mods.length > 0 && (
                                    <div>
                                        <p className={css({ fontSize: 'xs', color: 'textSubtle', mb: '1' })}>
                                            使用 mod
                                        </p>
                                        <div className={css({ display: 'flex', gap: '1.5', flexWrap: 'wrap' })}>
                                            {world.mods.map((m) => (
                                                <span
                                                    key={m.id}
                                                    className={css({
                                                        px: '2',
                                                        py: '1',
                                                        bg: 'secondary',
                                                        borderRadius: '4px',
                                                        fontSize: '11px',
                                                        color: 'textMuted',
                                                    })}
                                                >
                                                    {m.id}
                                                    {m.version && (
                                                        <span className={css({ color: 'textSubtle' })}>
                                                            {' '}
                                                            v{m.version}
                                                        </span>
                                                    )}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* スクロール先の副次アクション（お気に入り・新規インスタンス作成） */}
                        <div
                            className={css({
                                display: 'flex',
                                flexDir: 'column',
                                gap: '2',
                                pt: '3',
                                borderTop: '1px solid',
                                borderColor: 'border',
                            })}
                        >
                            <button
                                type="button"
                                onClick={() => void toggleFavorite(worldRef)}
                                aria-pressed={favorited}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '2',
                                    py: '2.5',
                                    bg: 'secondary',
                                    color: favorited ? 'warning' : 'text',
                                    border: '1px solid',
                                    borderColor: 'border',
                                    borderRadius: '10px',
                                    fontSize: 'sm',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    _hover: { opacity: 0.9 },
                                })}
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill={favorited ? 'currentColor' : 'none'}
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    aria-hidden="true"
                                >
                                    <path d="M11.48 3.5a.56.56 0 0 1 1.04 0l2.36 5.14 5.6.62c.5.05.7.68.32 1.02l-4.17 3.8 1.15 5.5a.56.56 0 0 1-.83.6L12 17.9l-4.94 2.88a.56.56 0 0 1-.83-.6l1.15-5.5-4.17-3.8a.56.56 0 0 1 .32-1.02l5.6-.62 2.35-5.14Z" />
                                </svg>
                                {favorited ? 'お気に入り済み' : 'お気に入りに追加'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCreate}
                                disabled={creating}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '2',
                                    py: '2.5',
                                    bg: 'secondary',
                                    color: 'text',
                                    border: '1px solid',
                                    borderColor: 'border',
                                    borderRadius: '10px',
                                    fontSize: 'sm',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    _hover: { opacity: 0.9 },
                                    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
                                })}
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    aria-hidden="true"
                                >
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                                {creating ? '作成中...' : 'このワールドで新しいインスタンスを作成'}
                            </button>
                            {error && <p className={css({ color: 'errorText', fontSize: 'xs' })}>{error}</p>}
                        </div>
                    </div>
                </div>

                {/* 右: 同ワールドの他インスタンス一覧（選ぶと詳細が切り替わる） */}
                <div
                    className={css({
                        p: '5',
                        borderLeft: { md: '1px solid' },
                        borderTop: { base: '1px solid', md: 'none' },
                        borderColor: 'border',
                        display: 'flex',
                        flexDir: 'column',
                        gap: '3',
                        minW: 0,
                    })}
                >
                    <h3 className={css({ fontSize: 'sm', fontWeight: 'bold', color: 'text' })}>
                        このワールドのインスタンス
                    </h3>
                    <div className={css({ display: 'flex', flexDir: 'column', gap: '2' })}>
                        {siblings.map((i) => {
                            const isCur = i.id === currentInstanceId;
                            const isSel = i.id === selected.id;
                            return (
                                <button
                                    key={i.id}
                                    type="button"
                                    onClick={() => setSelected(i)}
                                    className={css({
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '2',
                                        p: '3',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        bg: isSel ? 'surfaceHover' : 'secondary',
                                        border: '1px solid',
                                        borderColor: isSel ? 'primary' : 'border',
                                        borderRadius: '10px',
                                        _hover: { borderColor: 'primary' },
                                    })}
                                >
                                    <div className={css({ display: 'flex', flexDir: 'column', minW: 0 })}>
                                        <span className={css({ fontSize: 'xs', color: 'textMuted' })}>
                                            {i.access.type === 'public' ? '公開' : '限定'}
                                            {i.access.password ? ' · パスワードあり' : ''}
                                        </span>
                                        <span className={css({ fontSize: 'xs', color: 'textSubtle' })}>
                                            {i.stats.currentUsers} / {i.stats.maxUsers} 人
                                        </span>
                                    </div>
                                    {isCur && (
                                        <span className={css({ fontSize: 'xs', color: 'success', fontWeight: '600' })}>
                                            参加中
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
