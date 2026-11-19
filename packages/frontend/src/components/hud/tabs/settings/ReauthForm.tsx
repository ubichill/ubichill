import { useState } from 'react';
import { reauthenticate } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';

/** パスワードで本人確認をし直す（ログイン方法の変更・管理者の操作の前に。10 分有効）。 */
export function ReauthForm({ onDone }: { onDone: () => void }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await reauthenticate(password);
            setPassword('');
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : '確認できませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            <div className={css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap' })}>
                <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="パスワード"
                    aria-label="パスワード"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={input}
                />
                <button type="submit" className={button} disabled={busy || !password}>
                    {busy ? '確認中...' : '本人確認'}
                </button>
            </div>
            {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
        </form>
    );
}

const input = css({
    flex: '1 1 200px',
    maxW: '320px',
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    fontSize: '14px',
    bg: 'background',
    color: 'text',
});

const button = css({
    px: '4',
    py: '2',
    bg: 'primary',
    color: 'textOnPrimary',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
