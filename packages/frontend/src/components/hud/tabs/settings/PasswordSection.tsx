import { useId, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { changeMyPassword } from '@/lib/account/me';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import {
    settingsCard,
    settingsCardTitle,
    settingsInput,
    settingsLabel,
    settingsNote,
    settingsOutlineButton,
    settingsTextButton,
    settingsWideButton,
} from './settingsStyles';

interface PasswordSectionProps {
    /** 公開済みの開発用既定パスワードのまま（公式アカウント）。 */
    required: boolean;
    /** パスワードをサーバーの設定（Secret）で管理している（公式アカウント）。 */
    managedBySecret: boolean;
    onChanged: () => void;
}

/**
 * パスワード。「パスワードを変更」を押すと、今のパスワードと新しいパスワードを入れるダイアログが出る。
 * 公式アカウントのパスワードは Secret（OFFICIAL_ACCOUNT_PASSWORD）が正で起動のたびに合わせ直されるので、
 * 画面からは変更できないことを示すだけにする。
 */
export function PasswordSection({ required, managedBySecret, onChanged }: PasswordSectionProps) {
    const [open, setOpen] = useState(false);

    if (managedBySecret) {
        return (
            <section className={settingsCard}>
                <h2 className={settingsCardTitle}>パスワード</h2>
                <p className={settingsNote}>
                    このアカウントのパスワードはサーバーの設定（OFFICIAL_ACCOUNT_PASSWORD）で管理されています。
                    変更するときは設定の値を差し替えて再デプロイしてください（既存のログインは無効になります）。
                </p>
                {required && (
                    <p className={css({ fontSize: '12px', color: 'errorText', lineHeight: '1.6' })}>
                        公開されている開発用の既定パスワードのままです。OFFICIAL_ACCOUNT_PASSWORD
                        を設定して再起動してください。
                    </p>
                )}
            </section>
        );
    }

    return (
        <section className={settingsCard}>
            <h2 className={settingsCardTitle}>パスワード</h2>
            <button type="button" className={settingsOutlineButton} onClick={() => setOpen(true)}>
                パスワードを変更
            </button>
            <ChangePasswordDialog
                open={open}
                onClose={() => setOpen(false)}
                onChanged={() => {
                    setOpen(false);
                    pushToast('パスワードを変更しました。ほかの端末ではログインし直してください', 'info');
                    onChanged();
                }}
            />
        </section>
    );
}

function ChangePasswordDialog({
    open,
    onClose,
    onChanged,
}: {
    open: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const id = useId();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [shown, setShown] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const close = () => {
        setCurrent('');
        setNext('');
        setShown(false);
        setError('');
        onClose();
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await changeMyPassword(current, next);
            setCurrent('');
            setNext('');
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : '変更できませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} title="パスワードを変更" onClose={close}>
            <form onSubmit={submit} className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                <label htmlFor={`${id}-current`} className={settingsLabel}>
                    今のパスワード
                    <input
                        id={`${id}-current`}
                        className={settingsInput}
                        type="password"
                        autoComplete="current-password"
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        required
                    />
                </label>
                <label htmlFor={`${id}-next`} className={settingsLabel}>
                    新しいパスワード（8 文字以上）
                    <input
                        id={`${id}-next`}
                        className={settingsInput}
                        type={shown ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={8}
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        required
                    />
                </label>
                <button type="button" className={settingsTextButton} onClick={() => setShown((v) => !v)}>
                    {shown ? '新しいパスワードを隠す' : '新しいパスワードを表示'}
                </button>
                <p className={settingsNote}>変更すると、ほかの端末はログアウトします。</p>
                {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
                <button
                    type="submit"
                    className={settingsWideButton}
                    disabled={busy || current.length === 0 || next.length < 8}
                >
                    {busy ? '変更しています...' : '変更する'}
                </button>
                <button type="button" className={settingsTextButton} disabled={busy} onClick={close}>
                    やめる
                </button>
            </form>
        </Dialog>
    );
}
