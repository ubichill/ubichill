import { type Instance, type WorldListItem, worldSourceLabel } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';

interface InstanceDetailOverlayProps {
    instance: Instance;
    onClose: () => void;
    /** インスタンスに入る（＝参加）。 */
    onJoin: (instanceId: string) => void;
    /** 現在参加中のインスタンスID（一覧で「参加中」表示） */
    currentInstanceId?: string;
}

function formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * インスタンス詳細のオーバーレイ。**ルート遷移せず**（インスタンス内で見たまま）開く。
 * 左: サムネ＋ワールド情報（説明・詳細・使用 mod）、右: そのワールドの他インスタンス一覧。
 * ワールドの公開詳細ページ（ログイン不要）へは「ワールド詳細」で遷移する。
 */
export function InstanceDetailOverlay({ instance, onClose, onJoin, currentInstanceId }: InstanceDetailOverlayProps) {
    const navigate = useNavigate();
    const worldRef = instance.world.source?.url;
    // instance.world は最小情報なので、フル情報（説明/キャパ/mod/日付）を取得して補う。
    const [world, setWorld] = useState<Partial<WorldListItem>>(instance.world);
    const [siblings, setSiblings] = useState<Instance[]>([instance]);

    useEffect(() => {
        let cancelled = false;
        void fetch(`${API_BASE}/api/v1/worlds/${encodeURIComponent(instance.world.id)}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<WorldListItem>) : null))
            .then((w) => {
                if (!cancelled && w) setWorld(w);
            })
            .catch(() => undefined);
        const q = encodeURIComponent(worldRef ?? instance.world.id);
        void fetch(`${API_BASE}/api/v1/instances?worldId=${q}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<{ instances: Instance[] }>) : null))
            .then((data) => {
                if (!cancelled && data?.instances?.length) setSiblings(data.instances);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [instance.world.id, worldRef]);

    const detailRows: Array<{ label: string; value: string }> = [
        world.authorName ? { label: '作成者', value: world.authorName } : null,
        world.version ? { label: 'バージョン', value: `v${world.version}` } : null,
        world.capacity ? { label: 'キャパシティ', value: `${world.capacity.default}〜${world.capacity.max} 人` } : null,
        world.source ? { label: '由来', value: worldSourceLabel(world.source) } : null,
        formatDate(world.createdAt) ? { label: '公開日', value: formatDate(world.createdAt) } : null,
        formatDate(world.updatedAt) ? { label: '更新日', value: formatDate(world.updatedAt) } : null,
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
                {/* 左: サムネ + ワールド情報 + mod */}
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
                    <div className={css({ p: '5', display: 'flex', flexDir: 'column', gap: '3' })}>
                        <button
                            type="button"
                            onClick={() => navigate(`/world/${instance.world.id}`)}
                            className={css({
                                textAlign: 'left',
                                bg: 'transparent',
                                border: 'none',
                                p: 0,
                                cursor: 'pointer',
                                fontSize: 'lg',
                                fontWeight: 'bold',
                                color: 'text',
                                _hover: { textDecoration: 'underline' },
                            })}
                        >
                            {world.displayName}
                        </button>
                        {world.description && (
                            <p className={css({ color: 'textMuted', fontSize: 'sm', lineHeight: '1.6' })}>
                                {world.description}
                            </p>
                        )}
                        <dl className={css({ display: 'flex', flexDir: 'column', gap: '2' })}>
                            {detailRows.map((r) => (
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
                        {world.mods && world.mods.length > 0 && (
                            <div>
                                <p className={css({ fontSize: 'xs', color: 'textSubtle', mb: '1' })}>使用 mod</p>
                                <div className={css({ display: 'flex', gap: '1.5', flexWrap: 'wrap' })}>
                                    {world.mods.map((m) => (
                                        <span
                                            key={m}
                                            className={css({
                                                px: '2',
                                                py: '1',
                                                bg: 'secondary',
                                                borderRadius: '4px',
                                                fontSize: '11px',
                                                color: 'textMuted',
                                            })}
                                        >
                                            {m}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => navigate(`/world/${instance.world.id}`)}
                            className={css({
                                alignSelf: 'flex-start',
                                fontSize: 'xs',
                                color: 'primary',
                                bg: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                p: 0,
                            })}
                        >
                            ワールド詳細ページを開く
                        </button>
                    </div>
                </div>

                {/* 右: 同ワールドの他インスタンス一覧 */}
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
                            const full = i.status === 'full' || i.status === 'closing';
                            return (
                                <div
                                    key={i.id}
                                    className={css({
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '2',
                                        p: '3',
                                        bg: i.id === instance.id ? 'surfaceHover' : 'secondary',
                                        border: '1px solid',
                                        borderColor: i.id === instance.id ? 'primary' : 'border',
                                        borderRadius: '10px',
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
                                    {isCur ? (
                                        <span className={css({ fontSize: 'xs', color: 'success', fontWeight: '600' })}>
                                            参加中
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => onJoin(i.id)}
                                            disabled={full}
                                            className={css({
                                                px: '3',
                                                py: '2',
                                                bg: 'primary',
                                                color: 'textOnPrimary',
                                                border: 'none',
                                                borderRadius: '8px',
                                                fontSize: 'xs',
                                                fontWeight: '600',
                                                cursor: 'pointer',
                                                whiteSpace: 'nowrap',
                                                _hover: { opacity: 0.9 },
                                                _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                                            })}
                                        >
                                            {full ? '満員' : '入る'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
