import { useId, useState } from 'react';
import {
    buttonStyle,
    errorStyle,
    fieldStyle,
    formStyle,
    inputStyle,
    labelStyle,
    linkButtonStyle,
    otpInputStyle,
    subtitleStyle,
    titleStyle,
} from '@/components/auth/authStyles';
import { TwoFactorSignInFailure, verifyTwoFactorSignIn } from '@/lib/account/twoFactor';

/**
 * ログインの二段階目（パスワードかフェディバースで本人を確かめた後）。認証アプリのコードか、バックアップコードを入れる。
 * 期限切れ・何度も間違えたときは、最初のログインからやり直させる。
 */
export function TwoFactorSignInForm({
    onSignedIn,
    onRestart,
}: {
    onSignedIn: (returnTo: string | null) => void;
    onRestart: (message?: string) => void;
}) {
    const id = useId();
    const [backup, setBackup] = useState(false);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ready = backup ? code.replace(/[\s-]/g, '').length === 10 : code.length === 6;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const { returnTo } = await verifyTwoFactorSignIn(code);
            onSignedIn(returnTo);
        } catch (err) {
            if (err instanceof TwoFactorSignInFailure && err.code === 'challenge-expired') {
                onRestart(err.message);
                return;
            }
            setError(err instanceof Error ? err.message : 'ログインできませんでした');
            setCode('');
            setBusy(false);
        }
    };

    return (
        <>
            <h1 className={titleStyle}>二段階認証</h1>
            <p className={subtitleStyle}>
                {backup
                    ? '保存しておいたバックアップコードを 1 つ入力してください。'
                    : '認証アプリに表示されている 6 桁のコードを入力してください。'}
            </p>
            <form onSubmit={submit} className={formStyle} aria-busy={busy}>
                <div className={fieldStyle}>
                    <label htmlFor={`${id}-code`} className={labelStyle}>
                        {backup ? 'バックアップコード' : '認証コード'}
                    </label>
                    {backup ? (
                        <input
                            id={`${id}-code`}
                            className={inputStyle}
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="xxxxx-xxxxx"
                            maxLength={13}
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            aria-invalid={!!error}
                            aria-describedby={error ? `${id}-error` : undefined}
                        />
                    ) : (
                        <input
                            id={`${id}-code`}
                            className={otpInputStyle}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="000000"
                            maxLength={6}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            aria-invalid={!!error}
                            aria-describedby={error ? `${id}-error` : undefined}
                        />
                    )}
                </div>
                {error && (
                    <p id={`${id}-error`} role="alert" className={errorStyle}>
                        {error}
                    </p>
                )}
                <button type="submit" className={buttonStyle} disabled={busy || !ready}>
                    {busy ? '確認中...' : 'ログイン'}
                </button>
            </form>
            <button
                type="button"
                className={linkButtonStyle}
                disabled={busy}
                onClick={() => {
                    setBackup((v) => !v);
                    setCode('');
                    setError('');
                }}
            >
                {backup ? '認証アプリのコードを使う' : '認証アプリを使えないとき（バックアップコード）'}
            </button>
            <button type="button" className={linkButtonStyle} disabled={busy} onClick={() => onRestart()}>
                最初からログインし直す
            </button>
        </>
    );
}
