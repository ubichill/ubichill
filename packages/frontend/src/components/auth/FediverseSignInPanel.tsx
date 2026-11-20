import { useState } from 'react';
import { startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';
import { errorStyle, hintStyle, linkButtonStyle, titleStyle } from './authStyles';
import { MastodonLogo, MisskeyLogo } from './FediverseBrandIcons';
import { FediverseServerPicker } from './FediverseServerPicker';

/** ログイン画面の「Mastodon・Misskey で続ける」のボタン（ロゴだけ）。 */
export function FediverseSignInButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            className={logoButton}
            onClick={onClick}
            disabled={disabled}
            aria-label="Mastodon・Misskey のアカウントで続ける"
        >
            <MastodonLogo size={22} />
            <MisskeyLogo size={22} />
        </button>
    );
}

/**
 * ログインに使うサーバーを選び、そのサーバーの認証画面へ進む。ログインと新規登録はログイン画面のタブで選んだ方を渡す。
 * 登録済みかは認証の前に明かさない（外部アカウントと Ubichill のアカウントの結び付きを他人に見せない）ので、
 * どちらでも同じ認証に進み、結果に合わせて登録画面かログインになる。
 */
export function FediverseSignInPanel({
    returnTo,
    prefer,
    featuredServers,
    onBack,
}: {
    returnTo: string;
    prefer: 'sign-in' | 'sign-up';
    featuredServers: readonly string[];
    onBack: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const go = async (server: string) => {
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
            <h1 className={titleStyle}>{prefer === 'sign-up' ? '登録に使うサーバー' : 'ログインするサーバー'}</h1>
            <FediverseServerPicker
                featuredServers={featuredServers}
                busy={busy}
                confirmLabel="このサーバーで続ける"
                onChoose={(host) => void go(host)}
            />
            {busy && <p className={hintStyle}>サーバーの画面へ移動しています...</p>}
            {error && (
                <p role="alert" className={errorStyle}>
                    {error}
                </p>
            )}
            <button type="button" className={linkButtonStyle} onClick={onBack} disabled={busy}>
                戻る
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
    _disabled: { cursor: 'default', _hover: { bg: 'white' } },
});
