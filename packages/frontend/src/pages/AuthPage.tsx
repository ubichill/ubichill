import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useDisplayNameAvailability, useHandleAvailability } from '@/lib/account/useHandleAvailability';
import { registerWithOTP, resendOTP, signIn, verifyOTPAndRegister } from '@/lib/auth-client';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';
import { flex, vstack } from '@/styled-system/patterns';

type AuthMode = 'login' | 'register' | 'verify';

export function AuthPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    const { data: session, isPending } = useSession();
    const [mode, setMode] = useState<AuthMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [handle, setHandle] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [otp, setOtp] = useState('');
    const [registrationId, setRegistrationId] = useState('');
    const handleStatus = useHandleAvailability(handle, mode === 'register');
    const displayNameStatus = useDisplayNameAvailability(displayName, mode === 'register');

    // クールダウンタイマー
    useEffect(() => {
        if (resendCooldown > 0) {
            const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [resendCooldown]);

    // Redirect if already logged in
    useEffect(() => {
        if (session && !isPending) {
            navigate(from, { replace: true });
        }
    }, [session, isPending, navigate, from]);

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
                    setIsLoading(false);
                    return;
                }

                // 仮登録（OTP送信）
                const result = await registerWithOTP(email, password, displayName.trim(), handle.trim());

                if (!result.success) {
                    setError(result.error || '登録に失敗しました');
                } else if (result.skipVerification) {
                    // メール確認をスキップした場合は直接ログインへ
                    setSuccess(result.message || '登録が完了しました。ログインしてください。');
                    // 1.5秒後にログイン画面に遷移
                    setTimeout(() => {
                        setMode('login');
                        setPassword(''); // セキュリティのためパスワードをクリア
                    }, 1500);
                } else if (result.registrationId) {
                    // OTP入力画面へ遷移
                    setRegistrationId(result.registrationId);
                    setMode('verify');
                    setSuccess(result.message || '認証コードをメールに送信しました。');
                    setResendCooldown(60);
                } else {
                    setError('登録に失敗しました');
                }
            } else {
                // ログイン
                const result = await signIn.email({
                    email,
                    password,
                });

                if (result.error) {
                    setError(result.error.message || 'ログインに失敗しました');
                } else {
                    navigate(from, { replace: true });
                }
            }
        } catch {
            setError('エラーが発生しました。もう一度お試しください。');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOTP = useCallback(async () => {
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
    }, [registrationId, resendCooldown]);

    const handleVerifyOTP = useCallback(async () => {
        if (!registrationId || !otp) return;

        setError('');
        setSuccess('');
        setIsLoading(true);

        try {
            const result = await verifyOTPAndRegister(registrationId, otp);
            if (!result.success) {
                setError(result.error || '認証コードが正しくありません');
            } else {
                setSuccess('登録が完了しました！ログインしてください。');
                // 確認完了後、ログイン画面に戻る
                setTimeout(() => {
                    setMode('login');
                    setOtp('');
                    setRegistrationId('');
                    setDisplayName('');
                    setHandle('');
                    setPassword('');
                }, 1500);
            }
        } catch {
            setError('認証に失敗しました。');
        } finally {
            setIsLoading(false);
        }
    }, [registrationId, otp]);

    // ローディング中または既にログイン済みの場合
    if (isPending || (session && !isPending)) {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <p>読み込み中...</p>
                </div>
            </main>
        );
    }

    const handleBackToRegister = () => {
        setMode('register');
        setOtp('');
        setError('');
        setSuccess('');
    };

    // OTP入力画面
    if (mode === 'verify') {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <h1 className={titleStyle}>認証コードを入力</h1>
                    <p className={subtitleStyle}>{email} に6桁の認証コードを送信しました。</p>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleVerifyOTP();
                        }}
                        className={formStyle}
                    >
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
                        onClick={handleResendOTP}
                        disabled={isLoading || resendCooldown > 0}
                    >
                        {resendCooldown > 0 ? `再送信まで ${resendCooldown}秒` : '認証コードを再送信'}
                    </button>

                    <button type="button" className={linkButtonStyle} onClick={handleBackToRegister}>
                        登録画面に戻る
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className={containerStyle}>
            <div className={cardStyle}>
                <img src="/icon.png" alt="Ubichill" width={64} height={64} className={iconStyle} />
                <h1 className={titleStyle}>Ubichill</h1>
                <p className={subtitleStyle}>同じ空間で、作業も会話もいっしょに。</p>

                <div className={tabContainerStyle} role="group" aria-label="アカウントへのアクセス">
                    <button
                        type="button"
                        className={mode === 'login' ? tabActiveStyle : tabStyle}
                        onClick={() => {
                            setMode('login');
                            setError('');
                            setSuccess('');
                            setShowPassword(false);
                        }}
                        aria-pressed={mode === 'login'}
                        disabled={isLoading}
                    >
                        ログイン
                    </button>
                    <button
                        type="button"
                        className={mode === 'register' ? tabActiveStyle : tabStyle}
                        onClick={() => {
                            setMode('register');
                            setError('');
                            setSuccess('');
                            setShowPassword(false);
                        }}
                        aria-pressed={mode === 'register'}
                        disabled={isLoading}
                    >
                        新規登録
                    </button>
                </div>

                <form onSubmit={handleSubmit} className={formStyle} aria-busy={isLoading}>
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
                            メールアドレス
                        </label>
                        <input
                            id="email"
                            type="email"
                            inputMode="email"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="example@email.com"
                            className={inputStyle}
                            autoComplete="email"
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
                                onChange={(e) => setPassword(e.target.value)}
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

                    {error && (
                        <p role="alert" className={errorStyle}>
                            {error}
                        </p>
                    )}
                    {success && (
                        <p role="status" className={successStyle}>
                            {success}
                        </p>
                    )}

                    <button
                        type="submit"
                        className={buttonStyle}
                        disabled={
                            isLoading ||
                            (mode === 'register' &&
                                (handleStatus.state === 'checking' || displayNameStatus.state === 'checking'))
                        }
                    >
                        {isLoading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録'}
                    </button>
                </form>
            </div>
        </main>
    );
}

// Styles — Beige/Navy palette (from pencil-new.pen mockup)
const containerStyle = flex({
    minH: '100dvh',
    px: { base: '4', sm: '6' },
    py: '6',
    alignItems: 'center',
    justifyContent: 'center',
    bg: 'background',
});

const cardStyle = vstack({
    gap: '6',
    p: { base: '6', sm: '8' },
    bg: 'white',
    rounded: 'lg',
    border: '1px solid',
    borderColor: 'border',
    w: 'full',
    maxW: '400px',
});

const iconStyle = css({
    borderRadius: '14px',
});

const titleStyle = css({
    fontSize: { base: '2xl', sm: '3xl' },
    fontWeight: 'bold',
    color: 'text',
    wordBreak: 'auto-phrase',
});

const subtitleStyle = css({
    fontSize: 'sm',
    color: 'textMuted',
    textAlign: 'center',
    lineHeight: '1.7',
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});

const tabContainerStyle = flex({
    w: 'full',
    gap: '2',
    bg: 'surfaceHover',
    p: '1',
    rounded: 'lg',
});

const tabStyle = css({
    flex: 1,
    whiteSpace: 'nowrap',
    minH: '44px',
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textMuted',
    rounded: 'md',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { color: 'text' },
});

const tabActiveStyle = css({
    flex: 1,
    whiteSpace: 'nowrap',
    minH: '44px',
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textOnPrimary',
    bg: 'primaryHover',
    rounded: 'md',
    cursor: 'pointer',
});

const formStyle = vstack({
    gap: '4',
    w: 'full',
});

const fieldStyle = vstack({
    gap: '1',
    w: 'full',
    alignItems: 'flex-start',
});

const labelStyle = css({
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textMuted',
});

const inputStyle = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '3',
    fontSize: 'md',
    color: 'text',
    bg: 'surfaceHover',
    borderWidth: '1px',
    borderColor: 'border',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _placeholder: { color: 'textSubtle' },
    _focus: { borderColor: 'primaryHover', ring: '2', ringColor: 'primarySubtle' },
    '&[data-password]': { pr: '16' },
});

const inputErrorStyle = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '3',
    fontSize: 'md',
    color: 'text',
    bg: 'surfaceHover',
    borderWidth: '1px',
    borderColor: 'error',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _placeholder: { color: 'textSubtle' },
    _focus: { borderColor: 'error', ring: '2', ringColor: 'errorSubtle' },
});

const fieldErrorStyle = css({
    fontSize: 'xs',
    color: 'error',
});

const fieldSuccessStyle = css({
    fontSize: 'xs',
    color: 'successText',
});

const hintStyle = css({
    fontSize: 'xs',
    color: 'textSubtle',
    lineHeight: '1.6',
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});

const otpInputStyle = css({
    w: 'full',
    py: '4',
    px: '4',
    fontSize: '2xl',
    fontWeight: 'bold',
    color: 'text',
    textAlign: 'center',
    letterSpacing: '0.5em',
    bg: 'surfaceHover',
    borderWidth: '2px',
    borderColor: 'border',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _focus: { borderColor: 'primaryHover', ring: '2', ringColor: 'primarySubtle' },
});

const buttonStyle = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textOnPrimary',
    bg: 'primaryHover',
    rounded: 'lg',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { bg: 'primaryActive' },
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});

const linkButtonStyle = css({
    minH: '44px',
    py: '2',
    fontSize: 'sm',
    color: 'textMuted',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { color: 'text' },
});

const passwordToggleStyle = css({
    position: 'absolute',
    right: '1',
    top: '0',
    bottom: '0',
    minW: '48px',
    px: '2',
    color: 'text',
    fontSize: 'sm',
    fontWeight: 'medium',
    cursor: 'pointer',
    rounded: 'md',
    _hover: { bg: 'surfaceAccent' },
    _focusVisible: { outline: '2px solid token(colors.primary)', outlineOffset: '2px' },
});

const errorStyle = css({
    w: 'full',
    py: '2',
    px: '3',
    fontSize: 'sm',
    color: 'errorText',
    bg: 'errorBg',
    rounded: 'lg',
});

const successStyle = css({
    w: 'full',
    py: '2',
    px: '3',
    fontSize: 'sm',
    color: 'successText',
    bg: 'successBg',
    rounded: 'lg',
});

const verifyInfoStyle = css({
    w: 'full',
    py: '4',
    px: '4',
    fontSize: 'sm',
    color: 'textMuted',
    bg: 'surfaceHover',
    rounded: 'lg',
});

const verifyListStyle = css({
    mt: '2',
    ml: '4',
    listStyleType: 'disc',
    fontSize: 'xs',
    color: 'textMuted',
    '& li': {
        mt: '1',
    },
});
