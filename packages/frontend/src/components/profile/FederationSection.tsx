import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { type FederationPeer, fetchPeers, followPeer, unfollowPeer } from '@/lib/federationApi';
import { peerOriginOf } from '@/lib/peerOrigin';
import { css, cva } from '@/styled-system/css';

const button = cva({
    base: {
        padding: '8px 14px',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { opacity: 0.9 } },
            danger: { bg: 'surface', color: 'errorText', borderColor: 'border', _hover: { bg: 'errorBg' } },
        },
        size: { sm: { padding: '4px 10px', fontSize: '12px' } },
    },
});

const section = css({
    mb: '6',
    p: '4',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
});

const input = css({
    flex: 1,
    minWidth: '200px',
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    fontSize: '14px',
    bg: 'background',
    color: 'text',
});

function ServerIcon() {
    return (
        <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
    );
}

/**
 * 連合（このサーバーの管理者 = 公式アカウントだけ）。フォローしたサーバーの公開ワールドが、ワールド一覧の「グローバル」に出る。
 * ほかのサーバーの作者のワールドは写しを配らないので、たとえば公式ワールドを出すには https://ubichill.com をフォローする。
 */
export function FederationSection() {
    const confirm = useConfirm();
    const [peers, setPeers] = useState<FederationPeer[] | null>(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setPeers(await fetchPeers());
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めませんでした');
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const origin = peerOriginOf(draft);
    const alreadyFollowed = !!origin && !!peers?.some((p) => p.baseUrl === origin);

    const follow = async () => {
        if (!origin) return;
        setBusy(true);
        setError(null);
        try {
            await followPeer(origin);
            setDraft('');
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'フォローできませんでした');
        } finally {
            setBusy(false);
        }
    };

    const unfollow = async (peer: FederationPeer) => {
        const ok = await confirm(
            `${peer.baseUrl} のフォローをやめますか？ そのサーバーのワールドはワールド一覧に出なくなります（URL からは入れます）。`,
        );
        if (!ok) return;
        setBusy(true);
        setError(null);
        try {
            await unfollowPeer(peer.id);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'フォローをやめられませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={section}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' })}>連合</h2>
            <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' })}>
                フォローしたサーバーの公開ワールドが、ワールド一覧の「グローバル」に出ます。署名と作者はこのサーバーで確かめます。
                ほかのサーバーの作者のワールドは写しを配らないので、公式ワールドを出すには https://ubichill.com
                をフォローしてください。
            </p>

            <form
                className={css({ display: 'flex', gap: '2', flexWrap: 'wrap', mb: '3' })}
                onSubmit={(e) => {
                    e.preventDefault();
                    void follow();
                }}
            >
                <input
                    className={input}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="https://ubichill.com"
                    aria-label="フォローするサーバーの URL"
                />
                <button
                    type="submit"
                    className={button({ tone: 'primary' })}
                    disabled={busy || !origin || alreadyFollowed}
                >
                    フォローする
                </button>
            </form>
            {draft.trim() && !origin && (
                <p className={css({ fontSize: '12px', color: 'errorText', mb: '2' })}>
                    サーバーの URL として読めません
                </p>
            )}
            {alreadyFollowed && (
                <p className={css({ fontSize: '12px', color: 'textMuted', mb: '2' })}>{origin} はフォロー済みです</p>
            )}
            {error && <p className={css({ fontSize: '13px', color: 'errorText', mb: '2' })}>{error}</p>}

            {peers === null ? null : peers.length === 0 ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>まだフォローしていません。</p>
            ) : (
                <ul className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    {peers.map((peer) => (
                        <li
                            key={peer.id}
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3',
                                px: '3',
                                py: '2',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                bg: 'background',
                            })}
                        >
                            <span className={css({ color: 'textMuted', display: 'flex' })}>
                                <ServerIcon />
                            </span>
                            <span
                                className={css({
                                    flex: 1,
                                    minWidth: 0,
                                    fontSize: '14px',
                                    color: 'text',
                                    fontWeight: '600',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                })}
                            >
                                {peer.displayName ?? peer.baseUrl}
                            </span>
                            <button
                                type="button"
                                className={button({ tone: 'danger', size: 'sm' })}
                                disabled={busy}
                                onClick={() => void unfollow(peer)}
                            >
                                フォローをやめる
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
