import { useState } from 'react';
import { startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';
import { buttonStyle, errorStyle, linkButtonStyle, titleStyle } from './authStyles';
import { FediverseAccountInput } from './FediverseAccountInput';
import { MastodonLogo, MisskeyLogo } from './FediverseBrandIcons';

/** ログイン画面の「Mastodon・Misskey で続ける」のボタン（ロゴだけ）。 */
export function FediverseSignInButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            className={logoButton}
            onClick={onClick}
            aria-label="Mastodon・Misskey のアカウントで続ける"
        >
            <MastodonLogo size={22} />
            <MisskeyLogo size={22} />
        </button>
    );
}

/**
 * ユーザー ID を入れて、出てきたサーバーとアカウントを確かめてから、ログインか新規登録を選ぶ。
 * 登録済みかは認証の前に明かさない（外部アカウントと Ubichill のアカウントの結び付きを他人に見せない）ので、
 * どちらを押しても同じ認証に進み、結果に合わせて登録画面かログインになる。
 */
export function FediverseSignInPanel({
    returnTo,
    registrationOpen,
    onBack,
}: {
    returnTo: string;
    registrationOpen: boolean;
    onBack: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const go = async (server: string, prefer: 'sign-in' | 'sign-up') => {
        setBusy(true);
        setError('');
        try {
            await startFediverseSignIn({ server, intent: 'sign-in', prefer, returnTo });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'ログインを始められませんでした');
            setBusy(false);
        }
    };

    return (
        <>
            <div className={css({ display: 'flex', gap: '2', justifyContent: 'center' })} aria-hidden="true">
                <MastodonLogo size={36} />
                <MisskeyLogo size={36} />
            </div>
            <h1 className={titleStyle}>フェディバースで続ける</h1>
            <div className={css({ w: 'full' })}>
                <FediverseAccountInput
                    autoFocus
                    actions={(preview) => (
                        <div className={css({ display: 'flex', gap: '2', w: 'full' })}>
                            <button
                                type="button"
                                className={buttonStyle}
                                disabled={busy}
                                onClick={() => void go(preview.server.host, 'sign-in')}
                            >
                                ログイン
                            </button>
                            {registrationOpen && (
                                <button
                                    type="button"
                                    className={secondaryButton}
                                    disabled={busy}
                                    onClick={() => void go(preview.server.host, 'sign-up')}
                                >
                                    新規登録
                                </button>
                            )}
                        </div>
                    )}
                />
            </div>
            {error && (
                <p role="alert" className={errorStyle}>
                    {error}
                </p>
            )}
            <button type="button" className={linkButtonStyle} onClick={onBack} disabled={busy}>
                メールアドレスでログイン
            </button>
        </>
    );
}

const logoButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '3',
    w: 'full',
    minH: '44px',
    py: '2.5',
    bg: 'white',
    border: '1px solid',
    borderColor: 'border',
    rounded: 'lg',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { bg: 'surfaceHover' },
    _focusVisible: { outline: '2px solid token(colors.primary)', outlineOffset: '2px' },
});

const secondaryButton = css({
    w: 'full',
    minH: '44px',
    py: '2.5',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'text',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    rounded: 'lg',
    cursor: 'pointer',
    transition: 'all 0.2s',
    _hover: { bg: 'surfaceHover' },
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});
