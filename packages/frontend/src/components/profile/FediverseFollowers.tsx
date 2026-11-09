import type { FediverseFollower, FediverseOverview } from '@ubichill/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { UserAvatar, useOpenUser } from '@/components/social';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { withFollowerAnswered } from '@/lib/fediverse';
import { answerFollower, fetchFediverse } from '@/lib/fediverseApi';
import { pushToast } from '@/lib/toast';
import { css, cva } from '@/styled-system/css';

const label = css({ fontSize: '13px', fontWeight: '700', color: 'text', mb: '1' });
const note = css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.6' });

const smallButton = cva({
    base: {
        px: '3',
        py: '1',
        borderRadius: '8px',
        border: '1px solid',
        fontSize: '12px',
        fontWeight: '700',
        cursor: 'pointer',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary' },
            plain: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
        },
    },
});

function FollowerRow({
    follower,
    busy,
    children,
}: {
    follower: FediverseFollower;
    busy: boolean;
    children: ReactNode;
}) {
    const openUser = useOpenUser();
    const name = follower.name ?? follower.account;
    return (
        <li className={css({ display: 'flex', alignItems: 'center', gap: '3', py: '2', opacity: busy ? 0.6 : 1 })}>
            <button
                type="button"
                className={who}
                onClick={() => openUser({ id: follower.actorId, handle: follower.account })}
            >
                <UserAvatar user={{ name, image: follower.icon }} size="sm" />
                <span className={css({ display: 'flex', flexDirection: 'column', minW: 0 })}>
                    <span className={css({ fontSize: '13px', fontWeight: '700', color: 'text', truncate: true })}>
                        {name}
                    </span>
                    <span className={css({ fontSize: '12px', color: 'textMuted', truncate: true })}>
                        @{follower.account}
                    </span>
                </span>
            </button>
            <div className={css({ display: 'flex', gap: '2', flexShrink: 0 })}>{children}</div>
        </li>
    );
}

const who = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    minW: 0,
    flex: 1,
    p: 0,
    bg: 'transparent',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    _hover: { opacity: 0.8 },
});

/**
 * フェディバース（Mastodon・Misskey など）のアカウントと、承認待ち・フォロワー。押すとその人のプロフィール。
 * フォロワーに見えるのはプロフィールだけ（現在地や招待はフレンドだけ）。承認制などの設定は「プライバシー」。
 */
export function FediverseFollowers() {
    const confirm = useConfirm();
    const [overview, setOverview] = useState<FediverseOverview | null>(null);
    const [error, setError] = useState('');
    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchFediverse()
            .then((data) => !ctrl.cancelled && setOverview(data))
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めません'));
        return () => {
            ctrl.cancelled = true;
        };
    }, []);

    if (!overview) {
        return error ? <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p> : null;
    }

    const answer = async (follower: FediverseFollower, action: 'approve' | 'reject') => {
        if (
            follower.state === 'accepted' &&
            !(await confirm(`${follower.name ?? follower.account} さんをフォロワーから外しますか？`))
        ) {
            return;
        }
        setBusyIds((s) => new Set(s).add(follower.actorId));
        try {
            await answerFollower(follower.actorId, action);
            setOverview((current) => current && withFollowerAnswered(current, follower.actorId, action));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '操作できませんでした', 'error');
        } finally {
            setBusyIds((s) => {
                const next = new Set(s);
                next.delete(follower.actorId);
                return next;
            });
        }
    };

    const account = `@${overview.account}`;
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
            <div>
                <p className={label}>フェディバース（Mastodon・Misskey など）</p>
                {overview.enabled ? (
                    <>
                        <div className={css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
                            <code className={css({ fontSize: '13px', color: 'text', wordBreak: 'break-all' })}>
                                {account}
                            </code>
                            <button
                                type="button"
                                className={smallButton({ tone: 'plain' })}
                                onClick={() =>
                                    void navigator.clipboard
                                        .writeText(account)
                                        .then(() => pushToast('アカウントをコピーしました'))
                                        .catch(() => pushToast('コピーできませんでした', 'error'))
                                }
                            >
                                コピー
                            </button>
                        </div>
                        <p className={note}>
                            このアカウントを検索すると、ほかのサーバーからフォローできます。フォロワーに見えるのはプロフィールだけで、
                            いる場所や招待はフレンドだけに見えます。プロフィールには、作ったワールド・公開している mod・
                            お気に入りのワールド（公開範囲がパブリックのとき）が固定ノートとして出ます。
                        </p>
                    </>
                ) : (
                    <p className={note}>このサーバーはほかのサーバーとつながっていません。</p>
                )}
            </div>

            {overview.enabled && (
                <>
                    {overview.pending.length > 0 && (
                        <div>
                            <p className={label}>承認待ち（{overview.pending.length}）</p>
                            <ul>
                                {overview.pending.map((f) => (
                                    <FollowerRow key={f.actorId} follower={f} busy={busyIds.has(f.actorId)}>
                                        <button
                                            type="button"
                                            className={smallButton({ tone: 'primary' })}
                                            disabled={busyIds.has(f.actorId)}
                                            onClick={() => void answer(f, 'approve')}
                                        >
                                            承認
                                        </button>
                                        <button
                                            type="button"
                                            className={smallButton({ tone: 'plain' })}
                                            disabled={busyIds.has(f.actorId)}
                                            onClick={() => void answer(f, 'reject')}
                                        >
                                            拒否
                                        </button>
                                    </FollowerRow>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div>
                        <p className={label}>フォロワー（{overview.followerCount}）</p>
                        {overview.followers.length === 0 ? (
                            <p className={note}>まだいません。</p>
                        ) : (
                            <ul>
                                {overview.followers.map((f) => (
                                    <FollowerRow key={f.actorId} follower={f} busy={busyIds.has(f.actorId)}>
                                        <button
                                            type="button"
                                            className={smallButton({ tone: 'plain' })}
                                            disabled={busyIds.has(f.actorId)}
                                            onClick={() => void answer(f, 'reject')}
                                        >
                                            外す
                                        </button>
                                    </FollowerRow>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
