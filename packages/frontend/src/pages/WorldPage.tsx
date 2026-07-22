import type { Instance, WorldListItem } from '@ubichill/shared';
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
                    display: 'flex',
                    flexDir: 'column',
                    alignItems: 'center',
                    gap: 8,
                    p: { base: 4, md: 8 },
                })}
            >
                <HeroSection world={world} instances={instances} onCreate={handleCreate} creating={creating} />
                <HowToSection />
                {instances.length > 0 && <InstancesSection instances={instances} onJoin={handleJoin} />}
                <AboutSection />
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
        <section
            className={css({
                width: 'full',
                maxW: '3xl',
                display: 'flex',
                flexDir: 'column',
                alignItems: 'center',
                gap: 6,
                textAlign: 'center',
            })}
        >
            {world?.thumbnail && (
                <img
                    src={world.thumbnail}
                    alt={world.displayName}
                    className={css({
                        width: 'full',
                        maxW: 'md',
                        height: { base: '200px', md: '260px' },
                        objectFit: 'cover',
                        borderRadius: '2xl',
                        boxShadow: 'card',
                    })}
                />
            )}

            <div className={css({ display: 'flex', flexDir: 'column', gap: 3, alignItems: 'center' })}>
                <h1
                    className={css({
                        fontSize: { base: '3xl', md: '4xl' },
                        fontWeight: '800',
                        color: 'text',
                        lineHeight: '1.2',
                    })}
                >
                    {world?.displayName ?? 'ワールド'}
                </h1>
                {world?.description && (
                    <p className={css({ color: 'textMuted', fontSize: 'lg', maxW: 'lg', lineHeight: '1.6' })}>
                        {world.description}
                    </p>
                )}
            </div>

            <div
                className={css({
                    display: 'flex',
                    gap: 4,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    color: 'textSubtle',
                    fontSize: 'sm',
                })}
            >
                {world?.authorName && <MetaBadge icon="user" label={`作成者: ${world.authorName}`} />}
                {world?.version && <MetaBadge icon="tag" label={`v${world.version}`} />}
                {world?.capacity && <MetaBadge icon="users" label={`最大 ${world.capacity.max} 人`} />}
                {instances.length > 0 && (
                    <MetaBadge icon="activity" label={`現在 ${totalCurrentUsers} 人が遊んでいます`} />
                )}
            </div>

            <div className={css({ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' })}>
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
                    {creating ? '作成中...' : '新しいインスタンスを作成'}
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

function MetaBadge({ icon, label }: { icon: 'user' | 'tag' | 'users' | 'activity'; label: string }) {
    const iconSvg = {
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

function HowToSection() {
    const steps = [
        { title: 'アカウントを作る', body: '無料で登録。Google/GitHub でも OK。' },
        { title: 'インスタンスを作成', body: 'このページの「新しいインスタンスを作成」で部屋を作る。' },
        { title: 'ワールドに入る', body: 'ブラウザだけで即座に参加。招待 URL で友達も呼べる。' },
    ];
    return (
        <section className={css({ width: 'full', maxW: '3xl' })}>
            <h2 className={css({ fontSize: 'xl', fontWeight: '700', color: 'text', mb: 4, textAlign: 'center' })}>
                参加までのステップ
            </h2>
            <div
                className={css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: 'repeat(3, 1fr)' }, gap: 4 })}
            >
                {steps.map((step, idx) => (
                    <div
                        key={step.title}
                        className={css({
                            p: 5,
                            bg: 'surface',
                            borderRadius: 'xl',
                            border: '1px solid',
                            borderColor: 'border',
                            boxShadow: 'card',
                        })}
                    >
                        <span
                            className={css({
                                display: 'inline-flex',
                                width: '28px',
                                height: '28px',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 'full',
                                bg: 'primary',
                                color: 'textOnPrimary',
                                fontSize: 'sm',
                                fontWeight: '700',
                                mb: 3,
                            })}
                        >
                            {idx + 1}
                        </span>
                        <h3 className={css({ fontSize: 'md', fontWeight: '700', color: 'text', mb: 2 })}>
                            {step.title}
                        </h3>
                        <p className={css({ fontSize: 'sm', color: 'textMuted', lineHeight: '1.6' })}>{step.body}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

interface InstancesSectionProps {
    instances: Instance[];
    onJoin: (instanceId: string) => void;
}

function InstancesSection({ instances, onJoin }: InstancesSectionProps) {
    return (
        <section className={css({ width: 'full', maxW: '3xl' })}>
            <h2 className={css({ fontSize: 'xl', fontWeight: '700', color: 'text', mb: 4, textAlign: 'center' })}>
                参加可能なインスタンス
            </h2>
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

function AboutSection() {
    return (
        <section className={css({ width: 'full', maxW: '3xl', py: 6 })}>
            <div
                className={css({
                    p: { base: 5, md: 8 },
                    bg: 'surface',
                    borderRadius: '2xl',
                    border: '1px solid',
                    borderColor: 'border',
                    boxShadow: 'card',
                })}
            >
                <h2 className={css({ fontSize: 'xl', fontWeight: '700', color: 'text', mb: 3 })}>ubichill とは？</h2>
                <p className={css({ color: 'textMuted', lineHeight: '1.8', mb: 4 })}>
                    ubichill は、URL からワールドを読み込み、ブラウザだけで即座に参加できる 2D
                    メタバース基盤です。自分だけの部屋（インスタンス）を作って、
                    友達やコミュニティと同じ空間を共有できます。
                </p>
                <div
                    className={css({ display: 'flex', gap: 4, flexWrap: 'wrap', color: 'textSubtle', fontSize: 'sm' })}
                >
                    <span className={css({ display: 'flex', alignItems: 'center', gap: 2 })}>
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="m9 12 2 2 4-4" />
                        </svg>
                        ブラウザだけで参加
                    </span>
                    <span className={css({ display: 'flex', alignItems: 'center', gap: 2 })}>
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="m9 12 2 2 4-4" />
                        </svg>
                        外部ワールドも URL で遊べる
                    </span>
                    <span className={css({ display: 'flex', alignItems: 'center', gap: 2 })}>
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="m9 12 2 2 4-4" />
                        </svg>
                        リアルタイムカーソル同期
                    </span>
                </div>
            </div>
        </section>
    );
}
