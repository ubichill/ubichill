import type { AccountSessionView } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { revokeOtherSessions } from '@/lib/account/me';
import { fetchAccountSessions, revokeAccountSession } from '@/lib/account/sessions';
import { deviceLabelOf } from '@/lib/account/userAgent';
import { relativeTime } from '@/lib/notifications/notifications';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { settingsCard, settingsCardTitle, settingsNote, settingsOutlineButton } from './settingsStyles';

/**
 * ログイン中の端末。いつ・どの端末で・どの方法で入ったかを見せ、知らない端末をログアウトできる
 * （ログイン方法の追加にパスワードを求めないので、気付いて外せる手段を置く）。
 */
export function SessionsSection() {
    const confirm = useConfirm();
    const [sessions, setSessions] = useState<AccountSessionView[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        fetchAccountSessions()
            .then(setSessions)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
    }, []);

    useEffect(load, [load]);

    const run = async (key: string, action: () => Promise<void>) => {
        setBusy(key);
        setError('');
        try {
            await action();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'ログアウトできませんでした');
        } finally {
            setBusy(null);
            load();
        }
    };

    const others = sessions?.filter((s) => !s.current).length ?? 0;
    const now = Date.now();

    return (
        <section className={settingsCard}>
            <h2 className={settingsCardTitle}>ログイン中の端末</h2>
            <p className={settingsNote}>知らない端末があれば、ログアウトしてパスワードを変えてください。</p>
            {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
            {sessions && (
                <ul className={css({ display: 'flex', flexDirection: 'column' })}>
                    {sessions.map((s) => (
                        <li key={s.id} className={row}>
                            <span
                                className={css({
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5',
                                    minW: 0,
                                    mr: 'auto',
                                })}
                            >
                                <span className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
                                    <span className={label}>{deviceLabelOf(s.userAgent)}</span>
                                    {s.current && <span className={tag}>この端末</span>}
                                </span>
                                <span className={detail}>
                                    {[
                                        s.current ? '使用中' : `${relativeTime(s.lastActiveAt, now)}に使用`,
                                        s.via?.kind === 'fediverse'
                                            ? `${s.via.account} でログイン`
                                            : s.via?.kind === 'password'
                                              ? 'パスワードでログイン'
                                              : null,
                                        s.ipAddress,
                                    ]
                                        .filter(Boolean)
                                        .join(' ・ ')}
                                </span>
                            </span>
                            {!s.current && (
                                <button
                                    type="button"
                                    className={logoutButton}
                                    disabled={busy !== null}
                                    onClick={() => void run(s.id, () => revokeAccountSession(s.id))}
                                >
                                    {busy === s.id ? 'ログアウト中...' : 'ログアウト'}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <button
                type="button"
                className={settingsOutlineButton}
                disabled={busy !== null || others === 0}
                onClick={() =>
                    void (async () => {
                        if (!(await confirm('この端末以外のログインをすべて無効にしますか？'))) return;
                        await run('all', async () => {
                            const count = await revokeOtherSessions();
                            pushToast(`ほかの ${count} 台の端末をログアウトしました`, 'info');
                        });
                    })()
                }
            >
                ほかの端末をすべてログアウト
            </button>
            <p className={settingsNote}>
                パスワードを変えても、乗っ取りに使われたログインが残っていることがあります。心当たりが無いときはここで切ってください。
            </p>
        </section>
    );
}

const row = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    py: '2',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
});

const label = css({ fontSize: '14px', color: 'text', overflowWrap: 'anywhere' });
const detail = css({ fontSize: '12px', color: 'textMuted', overflowWrap: 'anywhere' });
const tag = css({
    flexShrink: 0,
    px: '1.5',
    py: '0.5',
    fontSize: '11px',
    fontWeight: '700',
    color: 'textOnPrimary',
    bg: 'primary',
    borderRadius: '4px',
});

const logoutButton = css({
    flexShrink: 0,
    px: '3',
    py: '1',
    fontSize: '12px',
    fontWeight: '700',
    color: 'text',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
