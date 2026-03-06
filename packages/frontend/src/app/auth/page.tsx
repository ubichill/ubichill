'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, registerWithOTP, resendOTP, signIn, useSession, verifyOTPAndRegister } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import { flex, vstack } from '@/styled-system/patterns';

type AuthMode = 'login' | 'register' | 'verify';

export default function AuthPage() {
    const router = useRouter();
    const { data: session, isPending } = useSession();
    const [mode, setMode] = useState<AuthMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [otp, setOtp] = useState('');
    const [usernameError, setUsernameError] = useState('');
    const [isCheckingUsername, setIsCheckingUsername] = useState(false);

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
            router.push('/');
        }
    }, [session, isPending, router]);

    // ユーザー名の重複チェック（デバウンス付き）
    useEffect(() => {
        const trimmedUsername = username.trim();
        if (!trimmedUsername || mode !== 'register') {
            setUsernameError('');
            return;
        }

        // 長さチェック（1-30文字）
        if (trimmedUsername.length < 1 || trimmedUsername.length > 30) {
            setUsernameError('ユーザー名は1〜30文字で入力してください');
            return;
        }

        let ignore = false;
        const timer = setTimeout(async () => {
            setIsCheckingUsername(true);
            try {
                const res = await fetch(
                    `${API_BASE}/api/v1/users/check-username?username=${encodeURIComponent(trimmedUsername)}`,
                );
                const data = await res.json();

                if (!ignore) {
                    if (!data.available) {
                        setUsernameError(data.error || 'このユーザー名は使用できません');
                    } else {
                        setUsernameError('');
                    }
                }
            } catch {
                if (!ignore) setUsernameError('確認に失敗しました');
            } finally {
                if (!ignore) setIsCheckingUsername(false);
            }
        }, 500);

        return () => {
            ignore = true;
            clearTimeout(timer);
        };
    }, [username, mode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);

        try {
            if (mode === 'register') {
                // ユーザー名のエラーがある場合は登録しない
                if (usernameError) {
                    setError(usernameError);
                    setIsLoading(false);
                    return;
                }

                // 仮登録（OTP送信）
                const result = await registerWithOTP(email, password, username.trim());

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
                } else {
                    // OTP入力画面へ遷移
                    setMode('verify');
                    setSuccess(result.message || '認証コードをメールに送信しました。');
                    setResendCooldown(60);
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
                    router.push('/');
                }
            }
        } catch {
            setError('エラーが発生しました。もう一度お試しください。');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOTP = useCallback(async () => {
        if (resendCooldown > 0 || !email) return;

        setError('');
        setSuccess('');
        setIsLoading(true);

        try {
            const result = await resendOTP(email);
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
    }, [email, resendCooldown]);

    const handleVerifyOTP = useCallback(async () => {
        if (!email || !otp) return;

        setError('');
        setSuccess('');
        setIsLoading(true);

        try {
            const result = await verifyOTPAndRegister(email, otp);
            if (!result.success) {
                setError(result.error || '認証コードが正しくありません');
            } else {
                setSuccess('登録が完了しました！ログインしてください。');
                // 確認完了後、ログイン画面に戻る
                setTimeout(() => {
                    setMode('login');
                    setOtp('');
                    setUsername('');
                    setPassword('');
                }, 1500);
            }
        } catch {
            setError('認証に失敗しました。');
        } finally {
            setIsLoading(false);
        }
    }, [email, otp]);

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
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="000000"
                                className={otpInputStyle}
                                maxLength={6}
                                autoComplete="one-time-code"
                            />
                        </div>

                        {error && <p className={errorStyle}>{error}</p>}
                        {success && <p className={successStyle}>{success}</p>}

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
                <Image src="/icon.png" alt="Ubichill" width={64} height={64} className={iconStyle} />
                <h1 className={titleStyle}>Ubichill</h1>
                <p className={subtitleStyle}>2Dメタバーススタイルのコラボレーションスペース</p>

                <div className={tabContainerStyle}>
                    <button
                        type="button"
                        className={mode === 'login' ? tabActiveStyle : tabStyle}
                        onClick={() => setMode('login')}
                    >
                        ログイン
                    </button>
                    <button
                        type="button"
                        className={mode === 'register' ? tabActiveStyle : tabStyle}
                        onClick={() => setMode('register')}
                    >
                        新規登録
                    </button>
                </div>

                <form onSubmit={handleSubmit} className={formStyle}>
                    {mode === 'register' && (
                        <div className={fieldStyle}>
                            <label htmlFor="username" className={labelStyle}>
                                ユーザー名
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value.slice(0, 30))}
                                placeholder="ユーザー名"
                                className={usernameError ? inputErrorStyle : inputStyle}
                                required
                            />
                            {isCheckingUsername && <p className={hintStyle}>確認中...</p>}
                            {usernameError && <p className={fieldErrorStyle}>{usernameError}</p>}
                            {!usernameError && username.trim().length >= 1 && !isCheckingUsername && (
                                <p className={fieldSuccessStyle}>このユーザー名は使用できます</p>
                            )}
                            <p className={hintStyle}>1〜30文字で自由に設定できます</p>
                        </div>
                    )}

                    <div className={fieldStyle}>
                        <label htmlFor="email" className={labelStyle}>
                            メールアドレス
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="example@email.com"
                            className={inputStyle}
                            required
                        />
                    </div>

                    <div className={fieldStyle}>
                        <label htmlFor="password" className={labelStyle}>
                            パスワード
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="8文字以上"
                            className={inputStyle}
                            minLength={8}
                            required
                        />
                    </div>

                    {error && <p className={errorStyle}>{error}</p>}
                    {success && <p className={successStyle}>{success}</p>}

                    <button
                        type="submit"
                        className={buttonStyle}
                        disabled={isLoading || (mode === 'register' && isCheckingUsername)}
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
    minH: 'screen',
    alignItems: 'center',
    justifyContent: 'center',
    bg: '#faf6f0',
});

const cardStyle = vstack({
    gap: '6',
    p: '8',
    bg: '#ffffff',
    rounded: 'xl',
    shadow: '0 8px 32px rgba(27, 42, 68, 0.08)',
    w: 'full',
    maxW: '400px',
});

const iconStyle = css({
    borderRadius: '14px',
});

const titleStyle = css({
    fontSize: '3xl',
    fontWeight: 'bold',
    color: '#1b2a44',
});

const subtitleStyle = css({
    fontSize: 'sm',
    color: '#5e6a82',
    textAlign: 'center',
});

const tabContainerStyle = flex({
    w: 'full',
    gap: '2',
    bg: '#ede4d6',
    p: '1',
    rounded: 'lg',
});

const tabStyle = css({
    flex: 1,
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: '#3d4f6a',
    rounded: 'md',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { color: '#1b2a44' },
});

const tabActiveStyle = css({
    flex: 1,
    py: '2',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: '#f8f3ea',
    bg: '#1e3155',
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
    color: '#3d4f6a',
});

const inputStyle = css({
    w: 'full',
    py: '2.5',
    px: '3',
    fontSize: 'sm',
    color: '#1b2a44',
    bg: '#ede4d6',
    borderWidth: '1px',
    borderColor: '#cebca2',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _placeholder: { color: '#8a7e6d' },
    _focus: { borderColor: '#1e3155', ring: '2', ringColor: 'rgba(30, 49, 85, 0.15)' },
});

const inputErrorStyle = css({
    w: 'full',
    py: '2.5',
    px: '3',
    fontSize: 'sm',
    color: '#1b2a44',
    bg: '#ede4d6',
    borderWidth: '1px',
    borderColor: '#c0392b',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _placeholder: { color: '#8a7e6d' },
    _focus: { borderColor: '#c0392b', ring: '2', ringColor: 'rgba(192, 57, 43, 0.15)' },
});

const fieldErrorStyle = css({
    fontSize: 'xs',
    color: '#c0392b',
});

const fieldSuccessStyle = css({
    fontSize: 'xs',
    color: '#27ae60',
});

const hintStyle = css({
    fontSize: 'xs',
    color: '#8a7e6d',
});

const otpInputStyle = css({
    w: 'full',
    py: '4',
    px: '4',
    fontSize: '2xl',
    fontWeight: 'bold',
    color: '#1b2a44',
    textAlign: 'center',
    letterSpacing: '0.5em',
    bg: '#ede4d6',
    borderWidth: '2px',
    borderColor: '#cebca2',
    rounded: 'lg',
    outline: 'none',
    transition: 'all 0.2s',
    _focus: { borderColor: '#1e3155', ring: '2', ringColor: 'rgba(30, 49, 85, 0.15)' },
});

const buttonStyle = css({
    w: 'full',
    py: '2.5',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: '#f8f3ea',
    bg: '#1e3155',
    rounded: 'lg',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { bg: '#263d68' },
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});

const linkButtonStyle = css({
    py: '2',
    fontSize: 'sm',
    color: '#5e6a82',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { color: '#1b2a44' },
});

const errorStyle = css({
    w: 'full',
    py: '2',
    px: '3',
    fontSize: 'sm',
    color: '#922b21',
    bg: '#f9e4e1',
    rounded: 'lg',
});

const successStyle = css({
    w: 'full',
    py: '2',
    px: '3',
    fontSize: 'sm',
    color: '#1e7e46',
    bg: '#e4f5ec',
    rounded: 'lg',
});

const verifyInfoStyle = css({
    w: 'full',
    py: '4',
    px: '4',
    fontSize: 'sm',
    color: '#3d4f6a',
    bg: '#ede4d6',
    rounded: 'lg',
});

const verifyListStyle = css({
    mt: '2',
    ml: '4',
    listStyleType: 'disc',
    fontSize: 'xs',
    color: '#5e6a82',
    '& li': {
        mt: '1',
    },
});
