import { useState } from 'react';
import { changeMyPassword } from '@/lib/account/me';
import { css } from '@/styled-system/css';

const input = css({
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    fontSize: '14px',
    bg: 'background',
    color: 'text',
    width: '100%',
    maxW: '320px',
});

interface PasswordSectionProps {
    /** 公開済みの開発用既定パスワードのまま（公式アカウント）。 */
    required: boolean;
    /** パスワードをサーバーの設定（Secret）で管理している（公式アカウント）。 */
    managedBySecret: boolean;
    onChanged: () => void;
}

/**
 * パスワードの変更。公式アカウントのパスワードは Secret（OFFICIAL_ACCOUNT_PASSWORD）が正で起動のたびに
 * 合わせ直されるので、画面からは変更できないことを示すだけにする。
 */
export function PasswordSection({ required, managedBySecret, onChanged }: PasswordSectionProps) {
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

    const mismatch = confirm.length > 0 && next !== confirm;
    const canSubmit = !busy && current.length > 0 && next.length >= 8 && next === confirm;

    const submit = async () => {
        setBusy(true);
        setMessage(null);
        try {
            await changeMyPassword(current, next);
            setCurrent('');
            setNext('');
            setConfirm('');
            setMessage({ tone: 'info', text: 'パスワードを変更しました。ほかの端末ではログインし直してください。' });
            onChanged();
        } catch (e) {
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : '変更できませんでした' });
        } finally {
            setBusy(false);
        }
    };

    if (managedBySecret) {
        return (
            <section
                className={css({
                    mb: '6',
                    p: '4',
                    bg: 'surface',
                    border: '1px solid',
                    borderColor: required ? 'errorText' : 'border',
                    borderRadius: '12px',
                })}
            >
                <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '2' })}>パスワード</h2>
                <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6' })}>
                    このアカウントのパスワードはサーバーの設定（OFFICIAL_ACCOUNT_PASSWORD）で管理されています。
                    変更するときは設定の値を差し替えて再デプロイしてください（既存のログインは無効になります）。
                </p>
                {required && (
                    <p className={css({ mt: '2', fontSize: '13px', color: 'errorText', lineHeight: '1.6' })}>
                        公開されている開発用の既定パスワードのままです。OFFICIAL_ACCOUNT_PASSWORD
                        を設定して再起動してください。
                    </p>
                )}
            </section>
        );
    }

    return (
        <section
            className={css({
                mb: '6',
                p: '4',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '12px',
            })}
        >
            <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' })}>
                <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text' })}>パスワード</h2>
                {!open && (
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className={css({
                            fontSize: '13px',
                            color: 'textMuted',
                            bg: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                        })}
                    >
                        変更する
                    </button>
                )}
            </div>
            {open && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2', mt: '3' })}>
                    <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="現在のパスワード"
                        aria-label="現在のパスワード"
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        className={input}
                    />
                    <input
                        type="password"
                        autoComplete="new-password"
                        placeholder="新しいパスワード（8文字以上）"
                        aria-label="新しいパスワード"
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        className={input}
                    />
                    <input
                        type="password"
                        autoComplete="new-password"
                        placeholder="新しいパスワード（確認）"
                        aria-label="新しいパスワード（確認）"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className={input}
                    />
                    {mismatch && (
                        <p className={css({ fontSize: '12px', color: 'errorText' })}>
                            確認用のパスワードが一致しません
                        </p>
                    )}
                    <button
                        type="button"
                        disabled={!canSubmit}
                        onClick={() => void submit()}
                        className={css({
                            alignSelf: 'flex-start',
                            px: '4',
                            py: '2',
                            bg: 'primary',
                            color: 'textOnPrimary',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                        })}
                    >
                        パスワードを変更
                    </button>
                </div>
            )}
            {message && (
                <p
                    className={css({
                        mt: '3',
                        fontSize: '13px',
                        color: message.tone === 'error' ? 'errorText' : 'textMuted',
                    })}
                >
                    {message.text}
                </p>
            )}
        </section>
    );
}
