import type { LoginMethods } from '@ubichill/shared';
import { useId, useState } from 'react';
import { startEmailLink, verifyEmailLink } from '@/lib/account/fediverseSignIn';
import { needsReauthentication } from '@/lib/account/loginMethods';
import { isReauthRequired } from '@/lib/apiError';
import { css } from '@/styled-system/css';
import { settingsPath } from '../../settingsLink';
import { ReauthPrompt } from './ReauthPrompt';
import { settingsInput, settingsLabel, settingsNote, settingsTextButton, settingsWideButton } from './settingsStyles';

type Step = { step: 'closed' } | { step: 'form' } | { step: 'code'; email: string };

/**
 * メールアドレスを足す（メールなしで登録した人）。アドレスとパスワードを入れ、届いたコードで確かめると、
 * メールアドレスとパスワードでもログインでき、お知らせもそのアドレスに届く。
 * ログイン手段を足すので直近の本人確認が要る（無ければ先に、フェディバースのアカウントでログインし直してもらう）。
 */
export function EmailLinkForm({
    methods,
    onLinked,
    onReauthenticated,
}: {
    methods: LoginMethods;
    onLinked: () => void;
    /** 本人確認を済ませた・サーバーに断られた（ログイン方法を読み直す） */
    onReauthenticated: () => void;
}) {
    const id = useId();
    const [state, setState] = useState<Step>({ step: 'closed' });
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [reauthRefused, setReauthRefused] = useState(false);

    const finish = () => {
        setState({ step: 'closed' });
        setEmail('');
        setPassword('');
        setCode('');
        onLinked();
    };

    const attempt = async (action: () => Promise<void>) => {
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (e) {
            if (isReauthRequired(e)) {
                setReauthRefused(true);
                onReauthenticated();
            } else setError(e instanceof Error ? e.message : 'うまくいきませんでした');
        } finally {
            setBusy(false);
        }
    };

    const send = () =>
        attempt(async () => {
            const status = await startEmailLink({ email, password });
            if (status === 'linked') finish();
            else {
                setCode('');
                setState({ step: 'code', email: email.trim().toLowerCase() });
            }
        });

    if (state.step === 'closed') {
        return (
            <button type="button" className={settingsWideButton} onClick={() => setState({ step: 'form' })}>
                メールアドレスを追加
            </button>
        );
    }

    if (needsReauthentication(methods, reauthRefused)) {
        return (
            <div className={stack}>
                <ReauthPrompt
                    methods={methods}
                    action="メールアドレスの追加"
                    returnTo={settingsPath('account')}
                    onDone={() => {
                        setReauthRefused(false);
                        onReauthenticated();
                    }}
                />
                <button type="button" className={settingsTextButton} onClick={() => setState({ step: 'closed' })}>
                    やめる
                </button>
            </div>
        );
    }

    if (state.step === 'code') {
        return (
            <form
                className={stack}
                onSubmit={(e) => {
                    e.preventDefault();
                    void attempt(async () => {
                        await verifyEmailLink(code);
                        finish();
                    });
                }}
            >
                <p className={settingsNote}>{state.email} に確認コードを送りました。10 分以内に入力してください。</p>
                <label htmlFor={`${id}-code`} className={settingsLabel}>
                    確認コード
                    <input
                        id={`${id}-code`}
                        className={settingsInput}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                </label>
                {error && <p className={errorText}>{error}</p>}
                <button type="submit" className={settingsWideButton} disabled={busy || code.length !== 6}>
                    {busy ? '確かめています...' : '確かめて追加'}
                </button>
                <div className={css({ display: 'flex', gap: '4' })}>
                    <button type="button" className={settingsTextButton} disabled={busy} onClick={() => void send()}>
                        コードを送り直す
                    </button>
                    <button
                        type="button"
                        className={settingsTextButton}
                        disabled={busy}
                        onClick={() => setState({ step: 'form' })}
                    >
                        アドレスを直す
                    </button>
                </div>
            </form>
        );
    }

    return (
        <form
            className={stack}
            onSubmit={(e) => {
                e.preventDefault();
                void send();
            }}
        >
            <label htmlFor={`${id}-email`} className={settingsLabel}>
                メールアドレス
                <input
                    id={`${id}-email`}
                    className={settingsInput}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
            </label>
            <label htmlFor={`${id}-password`} className={settingsLabel}>
                パスワード（メールアドレスでログインするとき使います。8 文字以上）
                <input
                    id={`${id}-password`}
                    className={settingsInput}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </label>
            {error && <p className={errorText}>{error}</p>}
            <button type="submit" className={settingsWideButton} disabled={busy || !email || password.length < 8}>
                {busy ? '送っています...' : '確認コードを送る'}
            </button>
            <button
                type="button"
                className={settingsTextButton}
                disabled={busy}
                onClick={() => {
                    setError('');
                    setState({ step: 'closed' });
                }}
            >
                やめる
            </button>
        </form>
    );
}

const stack = css({ display: 'flex', flexDirection: 'column', gap: '2' });
const errorText = css({ fontSize: '12px', color: 'errorText' });
