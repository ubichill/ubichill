import { type Instance, type WorldListItem, worldSourceLabel } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';

/**
 * ワールド詳細ページ (/world/:worldId)
 * URL 直アクセス対応。認証後に当ページへ戻るリダイレクトを保持する。
 * ソケット接続は行わない。
 *
 * このページは未認証ユーザーでも閲覧可能で、Web 検索・SNS 共有からの流入を想定する。
 * 視覚的に魅力的なランディングページ風にし、ubichill 未経験者でも「参加」という
 * 次のアクションが迷わず選べるようにする。
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

    // 公開ページ: 未認証でも閲覧可能。参加・作成時にだけ認証を要求する。
    useEffect(() => {
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
    }, [worldId]);

    // クライアント側メタ（タブ名 + JS 実行するクローラ向け）。
    // リンクプレビュー bot 向けの OGP は BFF が担う。
    useEffect(() => {
        if (!world) return;
        const prevTitle = document.title;
        document.title = `${world.displayName} — ubichill`;
        const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
            const sel = `meta[${attr}="${key}"]`;
            let el = document.head.querySelector<HTMLMetaElement>(sel);
            if (!el) {
                el = document.createElement('meta');
                el.setAttribute(attr, key);
                document.head.appendChild(el);
            }
            el.setAttribute('content', content);
        };
        const desc = world.description ?? `${world.displayName} — ubichill のワールド`;
        setMeta('name', 'description', desc);
        setMeta('property', 'og:title', world.displayName);
        setMeta('property', 'og:description', desc);
        if (world.thumbnail) setMeta('property', 'og:image', world.thumbnail);
        return () => {
            document.title = prevTitle;
        };
    }, [world]);

    const requireAuthThenGo = (next: () => void) => {
        if (isPending) return;
        if (!session) {
            navigate('/auth', { state: { from: `/world/${worldId}` }, replace: false });
            return;
        }
        next();
    };

    const handleJoin = (instanceId: string) => {
        requireAuthThenGo(() => navigate(`/instance/${instanceId}`, { state: { worldId } }));
    };

    const handleCreate = async () => {
        if (!worldId || creating) return;
        if (!session) {
            navigate('/auth', { state: { from: `/world/${worldId}` }, replace: false });
            return;
        }
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

    if (loading) {
        return (
            <div
                className={css({
                    minH: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bg: 'background',
                })}
            >
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
                    bg: 'background',
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
        <div className={css({ minH: '100vh', display: 'flex', flexDir: 'column', bg: 'background' })}>
            <Header />

            <main
                className={css({
                    flex: 1,
                    width: 'full',
                    maxW: '5xl',
                    mx: 'auto',
                    display: 'flex',
                    flexDir: 'column',
                    gap: 8,
                    p: { base: 4, md: 8 },
                })}
            >
                {/* 大サムネ + タイトル + 作成者 + 主要バッジ + 参加導線 */}
                <HeroSection world={world} instances={instances} onCreate={handleCreate} creating={creating} />
                {/* 説明 + 詳細情報（VRChat のワールド情報に相当。ここを優先表示） */}
                <DetailsSection world={world} />
                {/* 参加可能なインスタンス */}
                <InstancesSection instances={instances} onJoin={handleJoin} />
                {/* ubichill の説明・参加方法は最下部に控えめに置く */}
                <AboutFooter />
            </main>
        </div>
    );
}

function Header() {
    return (
        <header
            className={css({
                width: 'full',
                px: { base: 4, md: 8 },
                py: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid',
                borderColor: 'border',
                bg: 'surface',
            })}
        >
            <a
                href="/"
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    textDecoration: 'none',
                    color: 'text',
                })}
            >
                <img src="/icon.png" alt="" className={css({ width: '32px', height: '32px', borderRadius: '8px' })} />
                <span className={css({ fontSize: 'xl', fontWeight: '700' })}>ubichill</span>
            </a>
        </header>
    );
}

interface HeroSectionProps {
    world: WorldListItem | null;
    instances: Instance[];
    onCreate: () => void;
    creating: boolean;
}

function HeroSection({ world, instances, onCreate, creating }: HeroSectionProps) {
    const totalCurrentUsers = instances.reduce((sum, i) => sum + i.stats.currentUsers, 0);
    return (
        <section className={css({ width: 'full', display: 'flex', flexDir: 'column', gap: 5 })}>
            {/* 大きなサムネイル（16:9・全幅） */}
            <div
                className={css({
                    width: 'full',
                    aspectRatio: '16 / 9',
                    maxH: '460px',
                    borderRadius: '2xl',
                    overflow: 'hidden',
                    bg: 'surface',
                    border: '1px solid',
                    borderColor: 'border',
                    boxShadow: 'card',
                })}
            >
                {world?.thumbnail ? (
                    <img
                        src={world.thumbnail}
                        alt={world.displayName}
                        className={css({ width: 'full', height: 'full', objectFit: 'cover' })}
                    />
                ) : (
                    <div
                        className={css({
                            width: 'full',
                            height: 'full',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'textSubtle',
                        })}
                    >
                        No thumbnail
                    </div>
                )}
            </div>

            {/* タイトル + 作成者 + バッジ */}
            <div className={css({ display: 'flex', flexDir: 'column', gap: 3 })}>
                <h1
                    className={css({
                        fontSize: { base: '2xl', md: '4xl' },
                        fontWeight: '800',
                        color: 'text',
                        lineHeight: '1.2',
                        wordBreak: 'break-word',
                    })}
                >
                    {world?.displayName ?? 'ワールド'}
                </h1>
                {world?.authorName && (
                    <p className={css({ color: 'textMuted', fontSize: 'md' })}>
                        作成者: <span className={css({ color: 'text', fontWeight: '600' })}>{world.authorName}</span>
                    </p>
                )}
                <div
                    className={css({ display: 'flex', gap: 3, flexWrap: 'wrap', color: 'textSubtle', fontSize: 'sm' })}
                >
                    {world?.source && <MetaBadge icon="globe" label={worldSourceLabel(world.source)} />}
                    {world?.version && <MetaBadge icon="tag" label={`v${world.version}`} />}
                    {world?.capacity && <MetaBadge icon="users" label={`最大 ${world.capacity.max} 人`} />}
                    {totalCurrentUsers > 0 && <MetaBadge icon="activity" label={`${totalCurrentUsers} 人が接続中`} />}
                </div>
            </div>

            {/* 参加導線 */}
            <div className={css({ display: 'flex', gap: 4, flexWrap: 'wrap' })}>
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={creating}
                    className={css({
                        px: 8,
                        py: 4,
                        bg: 'primary',
                        color: 'textOnPrimary',
                        borderRadius: 'xl',
                        fontWeight: '700',
                        fontSize: 'lg',
                        cursor: 'pointer',
                        border: 'none',
                        boxShadow: 'card',
                        transition: 'transform 0.15s ease',
                        _hover: { transform: 'translateY(-2px)', bg: 'primaryHover' },
                        _disabled: { opacity: 0.6, cursor: 'not-allowed', transform: 'none' },
                    })}
                >
                    {creating ? '作成中...' : 'インスタンスを作成'}
                </button>
                <a
                    href="/"
                    className={css({
                        px: 8,
                        py: 4,
                        bg: 'surface',
                        color: 'text',
                        borderRadius: 'xl',
                        fontWeight: '600',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        border: '1px solid',
                        borderColor: 'border',
                        _hover: { bg: 'surfaceHover' },
                    })}
                >
                    ロビーへ戻る
                </a>
            </div>
        </section>
    );
}

/** ISO 文字列を YYYY/MM/DD に整形（不正値は空）。 */
function formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** VRChat の「World Info / Details」相当。説明と詳細情報を優先的に見せる。 */
function DetailsSection({ world }: { world: WorldListItem | null }) {
    if (!world) return null;
    const rows: Array<{ label: string; value: string }> = [
        world.authorName ? { label: '作成者', value: world.authorName } : null,
        { label: 'バージョン', value: `v${world.version}` },
        world.capacity ? { label: 'キャパシティ', value: `${world.capacity.default}〜${world.capacity.max} 人` } : null,
        { label: '由来', value: worldSourceLabel(world.source) },
        formatDate(world.createdAt) ? { label: '公開日', value: formatDate(world.createdAt) } : null,
        formatDate(world.updatedAt) ? { label: '更新日', value: formatDate(world.updatedAt) } : null,
    ].filter((r): r is { label: string; value: string } => r !== null);

    return (
        <section
            className={css({
                width: 'full',
                display: 'grid',
                gridTemplateColumns: { base: '1fr', md: '2fr 1fr' },
                gap: 6,
                alignItems: 'start',
            })}
        >
            <div>
                <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: 3 })}>説明</h2>
                <p className={css({ color: 'textMuted', lineHeight: '1.8', whiteSpace: 'pre-wrap' })}>
                    {world.description || '説明はありません。'}
                </p>
            </div>
            <div
                className={css({
                    bg: 'surface',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: 'xl',
                    p: 5,
                    boxShadow: 'card',
                })}
            >
                <h2 className={css({ fontSize: 'md', fontWeight: '700', color: 'text', mb: 3 })}>詳細</h2>
                <dl className={css({ display: 'flex', flexDir: 'column', gap: 3 })}>
                    {rows.map((r) => (
                        <div
                            key={r.label}
                            className={css({
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 4,
                                fontSize: 'sm',
                            })}
                        >
                            <dt className={css({ color: 'textSubtle' })}>{r.label}</dt>
                            <dd className={css({ color: 'text', fontWeight: '500', textAlign: 'right' })}>{r.value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    );
}

function MetaBadge({ icon, label }: { icon: 'user' | 'tag' | 'users' | 'activity' | 'globe'; label: string }) {
    const iconSvg = {
        globe: (
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
            </svg>
        ),
        user: (
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
        ),
        tag: (
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
                <circle cx="7" cy="7" r="2" />
            </svg>
        ),
        users: (
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
        activity: (
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        ),
    };
    return (
        <span
            className={css({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 1,
                bg: 'surface',
                borderRadius: 'full',
                border: '1px solid',
                borderColor: 'border',
            })}
        >
            {iconSvg[icon]}
            {label}
        </span>
    );
}

interface InstancesSectionProps {
    instances: Instance[];
    onJoin: (instanceId: string) => void;
}

function InstancesSection({ instances, onJoin }: InstancesSectionProps) {
    return (
        <section className={css({ width: 'full' })}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: 4 })}>参加可能なインスタンス</h2>
            {instances.length === 0 && (
                <p className={css({ color: 'textMuted', fontSize: 'sm' })}>
                    現在アクティブなインスタンスはありません。「インスタンスを作成」で新しく作成できます。
                </p>
            )}
            <div className={css({ display: 'flex', flexDir: 'column', gap: 3 })}>
                {instances.map((i) => (
                    <button
                        key={i.id}
                        type="button"
                        onClick={() => onJoin(i.id)}
                        className={css({
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 4,
                            bg: 'surface',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: 'xl',
                            textAlign: 'left',
                            cursor: 'pointer',
                            boxShadow: 'card',
                            _hover: { borderColor: 'primaryHighlight', bg: 'surfaceHover' },
                        })}
                    >
                        <div className={css({ display: 'flex', flexDir: 'column', gap: 1 })}>
                            <span className={css({ fontSize: 'sm', fontWeight: '600', color: 'text' })}>
                                {i.status === 'full' ? '満員' : '参加可能'}
                            </span>
                            <span className={css({ fontSize: 'xs', color: 'textMuted' })}>
                                {i.access.type === 'public'
                                    ? '公開'
                                    : i.access.type === 'friend_only'
                                      ? 'フレンド限定'
                                      : '招待制'}
                                {i.access.password ? ' · パスワードあり' : ''}
                            </span>
                        </div>
                        <span className={css({ fontSize: 'sm', color: 'textMuted', fontWeight: '500' })}>
                            {i.stats.currentUsers} / {i.stats.maxUsers} 人
                        </span>
                    </button>
                ))}
            </div>
        </section>
    );
}

/** ubichill 自体の説明・参加方法。ワールド情報より優先度は低いので最下部に控えめに置く。 */
function AboutFooter() {
    return (
        <section
            className={css({
                width: 'full',
                mt: 4,
                pt: 6,
                borderTop: '1px solid',
                borderColor: 'border',
                color: 'textSubtle',
                fontSize: 'sm',
                lineHeight: '1.7',
            })}
        >
            <p>
                <span className={css({ fontWeight: '700', color: 'textMuted' })}>ubichill</span> は URL
                からワールドを読み込み、ブラウザだけで即座に参加できる 2D メタバース基盤です。
                「インスタンスを作成」を押すと自分の部屋（インスタンス）を作って参加できます（要ログイン）。
            </p>
        </section>
    );
}
