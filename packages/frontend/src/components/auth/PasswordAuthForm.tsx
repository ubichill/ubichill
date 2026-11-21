import { BOT_CHECK_ACTIONS, type BotProtectionConfig, isTwoFactorRequired } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
    buttonStyle,
    errorStyle,
    fieldErrorStyle,
    fieldStyle,
    fieldSuccessStyle,
    formStyle,
    hintStyle,
    inputErrorStyle,
    inputStyle,
    labelStyle,
    linkButtonStyle,
    otpInputStyle,
    passwordToggleStyle,
    subtitleStyle,
    successStyle,
    verifyInfoStyle,
    verifyListStyle,
} from '@/components/auth/authStyles';
import { BotCheck } from '@/components/auth/BotCheck';
import { botCheckHeaders, fetchBotProtection, rejectedByBotCheck } from '@/lib/account/botProtection';
import { useDisplayNameAvailability, useHandleAvailability } from '@/lib/account/useHandleAvailability';
import { registerWithOTP, resendOTP, signIn, verifyOTPAndRegister } from '@/lib/auth-client';
import { css } from '@/styled-system/css';

export type PasswordAuthMode = 'login' | 'register';

/**
 * メールアドレス（ログインでは ID も）とパスワードでのログイン・新規登録。紹介のページの上のダイアログに出す。
 * 新規登録でメールの確認が要るサーバーでは、続けて届いたコードを入れる。
 */
export function PasswordAuthForm({
    mode,
    onModeChange,
    returnTo,
    adding,
    registrationOpen,
    initialError = '',
    onTwoFactor,
}: {
    mode: PasswordAuthMode;
    onModeChange: (mode: PasswordAuthMode) => void;
    /** ログインした後に移る先 */
    returnTo: string;
    /** ログインしたまま別のアカウントを足す */
    adding: boolean;
    registrationOpen: boolean;
    initialError?: string;
    /** パスワードの後に二段階目が要る */
    onTwoFactor: () => void;
}) {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [handle, setHandle] = useState('');
    const [error, setError] = useState(initialError);
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [otp, setOtp] = useState('');
    // メールに届いたコードを待っている登録（null は入れていない）
    const [registrationId, setRegistrationId] = useState<string | null>(null);
    const verifying = mode === 'register' && registrationId !== null;
    const handleStatus = useHandleAvailability(handle, mode === 'register' && !verifying);
    const displayNameStatus = useDisplayNameAvailability(displayName, mode === 'register' && !verifying);
    // ボット対策（使わないなら null）。トークンは 1 回しか使えないので、送るたびに round を変えて作り直す
    const [botProtection, setBotProtection] = useState<BotProtectionConfig | null>(null);
    const [botToken, setBotToken] = useState<string | null>(null);
    const [botRound, setBotRound] = useState(0);
    // パスワードを入れ始めたらウィジェットを出す。一度出したら、パスワードを消しても作り直さない（確かめ直させない）
    const [botCheckStarted, setBotCheckStarted] = useState(false);
    // 切り替えた後に、新しい形の最初の欄へフォーカスを移す（押したボタンが消えて body に飛ばないように）
    const focusAfterSwitch = useRef(false);

    useEffect(() => {
        // 読めなければ出さない（使っているなら、登録の応答が理由を返す）
        fetchBotProtection()
            .then(setBotProtection)
            .catch(() => setBotProtection(null));
    }, []);

    useEffect(() => {
        if (!focusAfterSwitch.current) return;
        focusAfterSwitch.current = false;
        document.getElementById(mode === 'register' ? 'displayName' : 'email')?.focus();
    }, [mode]);

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const refreshBotProtection = async (code: string | undefined) => {
        if (botProtection) setBotRound((n) => n + 1);
        if (rejectedByBotCheck(code)) {
            await fetchBotProtection()
                .then(setBotProtection)
                .catch(() => {});
        }
    };

    // 登録が済んだがログインしていない（メールの確認を飛ばさないサーバーの古い形など）ときは、ログインに移る
    const toLoginAfterRegistered = useCallback(() => {
        setSuccess('登録が完了しました。ログインしてください。');
        setTimeout(() => {
            setRegistrationId(null);
            setOtp('');
            setPassword('');
            onModeChange('login');
        }, 1500);
    }, [onModeChange]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);
        try {
            if (mode === 'register') {
                // 表示名・ID のどちらかが使えない場合は登録しない（どちらも一意）
                const blocking = [displayNameStatus, handleStatus].find((st) => st.state !== 'available');
                if (blocking) {
                    setError('error' in blocking ? blocking.error : '表示名と ID を確認してください');
                    return;
                }
                const result = await registerWithOTP(email, password, displayName.trim(), handle.trim(), botToken);
                await refreshBotProtection(result.code);
                if (!result.success) {
                    setError(result.error || '登録に失敗しました');
                } else if (result.skipVerification && result.signedIn) {
                    // そのままログインしている（セッションを読み直すため画面ごと移る）
                    window.location.assign(returnTo);
                } else if (result.skipVerification) {
                    toLoginAfterRegistered();
                } else if (result.registrationId) {
                    setRegistrationId(result.registrationId);
                    setSuccess(result.message || '認証コードをメールに送信しました。');
                    setResendCooldown(60);
                } else {
                    setError('登録に失敗しました');
                }
                return;
            }
            // ログイン（メールアドレスの代わりに ID でもよい）
            const result = await signIn.email({
                email: email.trim(),
                password,
                fetchOptions: { headers: botCheckHeaders(botToken) },
            });
            await refreshBotProtection(result.error?.code);
            if (result.error) {
                setError(signInErrorMessage(result.error));
            } else if (isTwoFactorRequired(result.data)) {
                setPassword('');
                onTwoFactor();
            } else if (adding) {
                // 前のアカウントの状態を持ち越さないよう、画面ごと読み直す
                window.location.assign(returnTo);
            } else {
                navigate(returnTo, { replace: true });
            }
        } catch {
            setError('エラーが発生しました。もう一度お試しください。');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOTP = async () => {
        if (resendCooldown > 0 || !registrationId) return;
        setError('');
        setSuccess('');
        setIsLoading(true);
        try {
            const result = await resendOTP(registrationId);
            if (!result.success) {
                setError(result.error || '認証コードの送信に失敗しました');
            } else {
                setSuccess('認証コードを再送信しました。メールをご確認ください。');
                setResendCooldown(60);
            }
        } catch {
            setError('認証コードの送信に失敗しました。');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOTP = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!registrationId || !otp) return;
        setError('');
        setSuccess('');
        setIsLoading(true);
        try {
            const result = await verifyOTPAndRegister(registrationId, otp);
            if (!result.success) {
                setError(result.error || '認証コードが正しくありません');
            } else if (result.signedIn) {
                // そのままログインしている（セッションを読み直すため画面ごと移る）
                window.location.assign(returnTo);
            } else {
                setDisplayName('');
                setHandle('');
                toLoginAfterRegistered();
            }
        } catch {
            setError('認証に失敗しました。');
        } finally {
            setIsLoading(false);
        }
    };

    const switchMode = (next: PasswordAuthMode) => {
        setError('');
        setSuccess('');
        setShowPassword(false);
        focusAfterSwitch.current = true;
        onModeChange(next);
    };

    const messages = (
        <>
            {error && (
                <p id="auth-error" role="alert" className={errorStyle}>
                    {error}
                </p>
            )}
            {success && (
                <p role="status" className={successStyle}>
                    {success}
                </p>
            )}
        </>
    );

    if (verifying) {
        return (
            <>
                <p className={subtitleStyle}>{email} に 6 桁の認証コードを送信しました。</p>
                <form onSubmit={handleVerifyOTP} className={formStyle} aria-busy={isLoading}>
                    <div className={fieldStyle}>
                        <label htmlFor="otp" className={labelStyle}>
                            認証コード
                        </label>
                        <input
                            id="otp"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            aria-invalid={!!error}
                            aria-describedby={error ? 'auth-error' : undefined}
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className={otpInputStyle}
                            maxLength={6}
                            autoComplete="one-time-code"
                        />
                    </div>
                    {messages}
                    <button type="submit" className={buttonStyle} disabled={isLoading || otp.length !== 6}>
                        {isLoading ? '確認中...' : '確認する'}
                    </button>
                </form>
                <div className={verifyInfoStyle}>
                    <p>コードが届かない場合:</p>
                    <ul className={verifyListStyle}>
                        <li>迷惑メールフォルダをご確認ください</li>
                        <li>コードは10分間有効です</li>
                    </ul>
                </div>
                <button
                    type="button"
                    className={linkButtonStyle}
                    onClick={() => void handleResendOTP()}
                    disabled={isLoading || resendCooldown > 0}
                >
                    {resendCooldown > 0 ? `再送信まで ${resendCooldown}秒` : '認証コードを再送信'}
                </button>
                <button
                    type="button"
                    className={linkButtonStyle}
                    onClick={() => {
                        setRegistrationId(null);
                        setOtp('');
                        setError('');
                        setSuccess('');
                    }}
                >
                    登録画面に戻る
                </button>
            </>
        );
    }

    return (
        <>
            <form
                onSubmit={handleSubmit}
                className={formStyle}
                aria-busy={isLoading}
                aria-label={mode === 'login' ? 'ログイン' : '新規登録'}
            >
                {mode === 'register' && (
                    <>
                        <div className={fieldStyle}>
                            <label htmlFor="displayName" className={labelStyle}>
                                表示名
                            </label>
                            <input
                                id="displayName"
                                autoComplete="nickname"
                                aria-invalid={'error' in displayNameStatus}
                                aria-describedby="display-name-status display-name-hint"
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value.slice(0, 30))}
                                placeholder="表示名"
                                className={
                                    displayNameStatus.state === 'invalid' || displayNameStatus.state === 'taken'
                                        ? inputErrorStyle
                                        : inputStyle
                                }
                                required
                            />
                            <div id="display-name-status" role="status">
                                {displayNameStatus.state === 'checking' && <p className={hintStyle}>確認中...</p>}
                                {'error' in displayNameStatus && (
                                    <p className={fieldErrorStyle}>{displayNameStatus.error}</p>
                                )}
                                {displayNameStatus.state === 'available' && (
                                    <p className={fieldSuccessStyle}>この表示名は使用できます</p>
                                )}
                            </div>
                            <p id="display-name-hint" className={hintStyle}>
                                日本語も使えます。他の人と同じ名前は使えません（あとから変更できます）
                            </p>
                        </div>
                        <div className={fieldStyle}>
                            <label htmlFor="handle" className={labelStyle}>
                                ID
                            </label>
                            <input
                                id="handle"
                                autoComplete="off"
                                aria-invalid={'error' in handleStatus}
                                aria-describedby="handle-status handle-hint"
                                type="text"
                                value={handle}
                                onChange={(e) => setHandle(e.target.value.toLowerCase().slice(0, 30))}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                className={
                                    handleStatus.state === 'invalid' || handleStatus.state === 'taken'
                                        ? inputErrorStyle
                                        : inputStyle
                                }
                                required
                            />
                            <div id="handle-status" role="status">
                                {handleStatus.state === 'checking' && <p className={hintStyle}>確認中...</p>}
                                {'error' in handleStatus && <p className={fieldErrorStyle}>{handleStatus.error}</p>}
                                {handleStatus.state === 'available' && (
                                    <p className={fieldSuccessStyle}>この ID は使用できます</p>
                                )}
                            </div>
                            <p id="handle-hint" className={hintStyle}>
                                英小文字・数字・_ の 3〜30 文字。URL
                                や作者署名（@ID@サーバー）に使われ、あとから変更できません
                            </p>
                        </div>
                    </>
                )}

                <div className={fieldStyle}>
                    <label htmlFor="email" className={labelStyle}>
                        {mode === 'login' ? 'メールアドレスまたは ID' : 'メールアドレス'}
                    </label>
                    <input
                        id="email"
                        type={mode === 'login' ? 'text' : 'email'}
                        inputMode="email"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={mode === 'login' ? 'example@email.com または ID' : 'example@email.com'}
                        className={inputStyle}
                        // パスワードの管理ツールに、メールアドレスをアカウントの名前として覚えさせる
                        autoComplete="username"
                        required
                    />
                </div>

                <div className={fieldStyle}>
                    <label htmlFor="password" className={labelStyle}>
                        パスワード
                    </label>
                    <div className={css({ position: 'relative', w: 'full' })}>
                        <input
                            id="password"
                            type={showPassword ? 'text' : 'password'}
                            data-password
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                if (e.target.value !== '') setBotCheckStarted(true);
                            }}
                            placeholder="8文字以上"
                            className={inputStyle}
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            minLength={8}
                            required
                        />
                        <button
                            type="button"
                            className={passwordToggleStyle}
                            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                            aria-controls="password"
                            aria-pressed={showPassword}
                            onClick={() => setShowPassword((value) => !value)}
                        >
                            {showPassword ? '隠す' : '表示'}
                        </button>
                    </div>
                </div>

                {/* パスワードを入れ始めてから出す（画面を見ただけ・フェディバースで入る人には外部のスクリプトを読ませない） */}
                {botProtection && botCheckStarted && (
                    <BotCheck
                        // ログインと登録で action が違うので、替えたら作り直す
                        key={`${mode}:${botRound}`}
                        provider={botProtection.provider}
                        siteKey={botProtection.siteKey}
                        action={mode === 'login' ? BOT_CHECK_ACTIONS.signIn : BOT_CHECK_ACTIONS.signUp}
                        onToken={setBotToken}
                    />
                )}

                {messages}

                <button
                    type="submit"
                    className={buttonStyle}
                    disabled={
                        isLoading ||
                        (botProtection !== null && botToken === null) ||
                        (mode === 'register' &&
                            (handleStatus.state === 'checking' || displayNameStatus.state === 'checking'))
                    }
                >
                    {isLoading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録'}
                </button>
            </form>

            {mode === 'login' && registrationOpen && (
                <p className={switchModeStyle}>
                    アカウントをお持ちでない方は
                    <button
                        type="button"
                        className={switchModeButtonStyle}
                        onClick={() => switchMode('register')}
                        disabled={isLoading}
                    >
                        新規登録
                    </button>
                </p>
            )}
            {mode === 'register' && (
                <p className={switchModeStyle}>
                    アカウントをお持ちの方は
                    <button
                        type="button"
                        className={switchModeButtonStyle}
                        onClick={() => switchMode('login')}
                        disabled={isLoading}
                    >
                        ログイン
                    </button>
                </p>
            )}
        </>
    );
}

const switchModeStyle = css({ fontSize: 'sm', color: 'textMuted', textAlign: 'center' });
const switchModeButtonStyle = css({
    ml: '1',
    color: 'text',
    fontWeight: 'medium',
    textDecoration: 'underline',
    cursor: 'pointer',
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});

/** better-auth のログインの失敗を、画面の言葉にする */
function signInErrorMessage(error: { code?: string; message?: string }): string {
    switch (error.code) {
        case 'INVALID_EMAIL_OR_PASSWORD':
            return 'メールアドレス（または ID）かパスワードが違います';
        // `@` を含むとメールアドレスとして扱う。フェディバースの書き方（@alice）で入れた人に向けて
        case 'INVALID_EMAIL':
            return 'メールアドレスの形が正しくありません。ID は @ を付けずに入れてください';
        default:
            return error.message || 'ログインに失敗しました';
    }
}
