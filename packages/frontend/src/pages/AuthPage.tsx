import {
    BOT_CHECK_ACTIONS,
    type BotProtectionConfig,
    DEFAULT_SERVER_NAME,
    isTwoFactorRequired,
    safeReturnTo,
} from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
    buttonStyle,
    cardStyle,
    containerStyle,
    dividerStyle,
    errorStyle,
    fieldErrorStyle,
    fieldStyle,
    fieldSuccessStyle,
    formStyle,
    hintStyle,
    iconStyle,
    inputErrorStyle,
    inputStyle,
    labelStyle,
    linkButtonStyle,
    otpInputStyle,
    passwordToggleStyle,
    pendingStyle,
    subtitleStyle,
    successStyle,
    titleStyle,
    verifyInfoStyle,
    verifyListStyle,
} from '@/components/auth/authStyles';
import { BotCheck } from '@/components/auth/BotCheck';
import { FediverseSignInButton, FediverseSignInPanel } from '@/components/auth/FediverseSignInPanel';
import { FediverseSignUpForm } from '@/components/auth/FediverseSignUpForm';
import { TwoFactorSignInForm } from '@/components/auth/TwoFactorSignInForm';
import { botCheckHeaders, fetchBotProtection, rejectedByBotCheck } from '@/lib/account/botProtection';
import { readFediverseReturn, returnPathOf } from '@/lib/account/fediverseReturn';
import { type FediverseSignInOptions, fetchFediverseSignInOptions } from '@/lib/account/fediverseSignIn';
import { useDisplayNameAvailability, useHandleAvailability } from '@/lib/account/useHandleAvailability';
import { registerWithOTP, resendOTP, signIn, verifyOTPAndRegister } from '@/lib/auth-client';
import { fetchServerOverview } from '@/lib/server/serverInfo';
import { useSession } from '@/lib/session';
import { css, cx } from '@/styled-system/css';

type AuthMode = 'login' | 'register' | 'verify';

export function AuthPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const from = returnPathOf(location.state);
    const { data: session, isPending } = useSession();
    const fediverseReturn = readFediverseReturn(location.search);
    // ログインしたまま別のアカウントを足す（アカウントのメニューの「アカウントを追加」）
    const adding = new URLSearchParams(location.search).get('add') === '1';
    // ログインの二段階目（パスワードの後、またはフェディバースの認証から ?two_factor=1 で戻った）
    const [twoFactor, setTwoFactor] = useState(new URLSearchParams(location.search).get('two_factor') === '1');
    // null は読み込み中。読み込み中もボタンの場所を取っておき、届いた後に画面がずれないようにする
    const [fediverseOptions, setFediverseOptions] = useState<FediverseSignInOptions | null>(null);
    const [fediverseOpen, setFediverseOpen] = useState(false);
    // 紹介のページの「新規登録」からは ?mode=register で来る
    const [mode, setMode] = useState<AuthMode>(
        new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login',
    );
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [handle, setHandle] = useState('');
    // フェディバースの認証から失敗して戻ったときは、その理由を最初から出す
    const [error, setError] = useState(fediverseReturn.error ?? '');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [otp, setOtp] = useState('');
    const [registrationId, setRegistrationId] = useState('');
    const handleStatus = useHandleAvailability(handle, mode === 'register');
    const displayNameStatus = useDisplayNameAvailability(displayName, mode === 'register');
    // 新規登録・ログインのボット対策（使わないなら null）。トークンは 1 回しか使えないので、送るたびに round を変えて作り直す
    const [botProtection, setBotProtection] = useState<BotProtectionConfig | null>(null);
    const [botToken, setBotToken] = useState<string | null>(null);
    const [botRound, setBotRound] = useState(0);
    // サーバーの名前（コントロールパネルの「全般」）。null は読み込み中
    const [serverName, setServerName] = useState<string | null>(null);

    useEffect(() => {
        fetchFediverseSignInOptions()
            .then(setFediverseOptions)
            .catch(() => setFediverseOptions({ enabled: false, registrationOpen: false, featuredServers: [] }));
        // 読めなければ出さない（使っているなら、登録の応答が理由を返す）
        fetchBotProtection()
            .then(setBotProtection)
            .catch(() => setBotProtection(null));
        fetchServerOverview()
            .then((overview) => setServerName(overview.info.name))
            .catch(() => setServerName(DEFAULT_SERVER_NAME));
    }, []);

    // クールダウンタイマー
    useEffect(() => {
        if (resendCooldown > 0) {
            const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [resendCooldown]);

    // Redirect if already logged in
    useEffect(() => {
        // 二段階目の途中は移らない（アカウントの追加では、元のアカウントのセッションが残っている）
        if (session && !isPending && !adding && !twoFactor) {
            navigate(from, { replace: true });
        }
    }, [session, isPending, navigate, from, adding, twoFactor]);

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
                const result = await registerWithOTP(email, password, displayName.trim(), handle.trim(), botToken);
                if (botProtection) setBotRound((n) => n + 1);
                if (rejectedByBotCheck(result.code)) {
                    await fetchBotProtection()
                        .then(setBotProtection)
                        .catch(() => {});
                }

                if (!result.success) {
                    setError(result.error || '登録に失敗しました');
                } else if (result.skipVerification && result.signedIn) {
                    // メール確認を飛ばすサーバーでは、そのままログインしている（セッションを読み直すため画面ごと移る）
                    window.location.assign(from);
                } else if (result.skipVerification) {
                    setSuccess('登録が完了しました。ログインしてください。');
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
                // ログイン（メールアドレスの代わりに ID でもよい）
                const result = await signIn.email({
                    email: email.trim(),
                    password,
                    fetchOptions: { headers: botCheckHeaders(botToken) },
                });
                if (botProtection) setBotRound((n) => n + 1);
                if (result.error && rejectedByBotCheck(result.error.code)) {
                    await fetchBotProtection()
                        .then(setBotProtection)
                        .catch(() => {});
                }

                if (result.error) {
                    setError(
                        result.error.code === 'INVALID_EMAIL_OR_PASSWORD'
                            ? 'メールアドレス（または ID）かパスワードが違います'
                            : result.error.message || 'ログインに失敗しました',
                    );
                } else if (isTwoFactorRequired(result.data)) {
                    setPassword('');
                    setTwoFactor(true);
                } else if (adding) {
                    // 前のアカウントの状態を持ち越さないよう、画面ごと読み直す
                    window.location.assign(from);
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
            } else if (result.signedIn) {
                // そのままログインしている（セッションを読み直すため画面ごと移る）
                window.location.assign(from);
            } else {
                setSuccess('登録が完了しました。ログインしてください。');
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
    }, [registrationId, otp, from]);

    // 既にログイン済みなら、元の画面へ移るまでの間だけ（ログイン状態を確かめている間は下のフォームが場所を取る）
    if (session && !isPending && !adding && !twoFactor) {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <p>読み込み中...</p>
                </div>
            </main>
        );
    }

    if (twoFactor) {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <TwoFactorSignInForm
                        // セッションを読み直すため、画面ごと移る
                        onSignedIn={(returnTo) => window.location.assign(safeReturnTo(returnTo ?? from))}
                        onRestart={(message) => {
                            setTwoFactor(false);
                            setMode('login');
                            setError(message ?? '');
                            navigate(`/auth${adding ? '?add=1' : ''}`, { replace: true, state: location.state });
                        }}
                    />
                </div>
            </main>
        );
    }

    if (fediverseReturn.signUp) {
        return <FediverseSignUpForm onCancel={() => navigate('/auth', { replace: true })} />;
    }

    if (fediverseOpen) {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <FediverseSignInPanel
                        returnTo={from}
                        prefer={mode === 'register' && fediverseOptions?.registrationOpen ? 'sign-up' : 'sign-in'}
                        featuredServers={fediverseOptions?.featuredServers ?? []}
                        onBack={() => setFediverseOpen(false)}
                    />
                </div>
            </main>
        );
    }

    // ログインと新規登録を替える（読み込み直しても同じ方を開くよう、URL にも残す）
    const switchMode = (next: 'login' | 'register') => {
        setMode(next);
        setError('');
        setSuccess('');
        setShowPassword(false);
        const params = new URLSearchParams(location.search);
        if (next === 'register') params.set('mode', 'register');
        else params.delete('mode');
        const query = params.toString();
        navigate(`/auth${query ? `?${query}` : ''}`, { replace: true, state: location.state });
    };

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
            {/* ログイン状態を確かめている間も同じ大きさで場所を取り、見えなくしておく（届いた後に画面がずれない） */}
            <div className={cx(cardStyle, isPending && pendingStyle)} aria-busy={isPending} inert={isPending}>
                <Link to="/" aria-label="サーバーの紹介へ">
                    <img src="/icon.png" alt="" width={64} height={64} className={iconStyle} />
                </Link>
                <h1 className={cx(titleStyle, serverName === null && pendingStyle)}>
                    {serverName ?? DEFAULT_SERVER_NAME}
                </h1>
                {adding && <p className={subtitleStyle}>追加するアカウントでログインしてください</p>}

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

                    {/* パスワードを入れ始めてから出す（画面を見ただけ・フェディバースで入る人には外部のスクリプトを読ませない） */}
                    {botProtection && password !== '' && (
                        <BotCheck
                            // ログインと登録で action が違うので、替えたら作り直す
                            key={`${mode}:${botRound}`}
                            provider={botProtection.provider}
                            siteKey={botProtection.siteKey}
                            action={mode === 'login' ? BOT_CHECK_ACTIONS.signIn : BOT_CHECK_ACTIONS.signUp}
                            onToken={setBotToken}
                        />
                    )}

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
                            (botProtection !== null && botToken === null) ||
                            (mode === 'register' &&
                                (handleStatus.state === 'checking' || displayNameStatus.state === 'checking'))
                        }
                    >
                        {isLoading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録'}
                    </button>
                </form>

                {adding && (
                    <button type="button" className={linkButtonStyle} onClick={() => navigate('/')}>
                        今のアカウントに戻る
                    </button>
                )}

                {fediverseOptions?.enabled !== false && (
                    <>
                        <div className={dividerStyle} role="separator">
                            または
                        </div>
                        <FediverseSignInButton
                            disabled={fediverseOptions === null}
                            onClick={() => {
                                setError('');
                                setSuccess('');
                                setFediverseOpen(true);
                            }}
                        />
                    </>
                )}

                {mode === 'login' && fediverseOptions?.registrationOpen !== false && (
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
            </div>
        </main>
    );
}

const switchModeStyle = css({ fontSize: 'sm', color: 'textMuted' });
const switchModeButtonStyle = css({
    ml: '1',
    color: 'text',
    fontWeight: 'medium',
    textDecoration: 'underline',
    cursor: 'pointer',
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});
