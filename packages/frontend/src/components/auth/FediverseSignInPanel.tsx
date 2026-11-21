import { useId, useState } from 'react';
import { startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';
import { errorStyle, hintStyle } from './authStyles';
import { MastodonLogo, MisskeyLogo } from './FediverseBrandIcons';
import { FediverseServerPicker } from './FediverseServerPicker';

/**
 * 紹介のページに最初から出す、Mastodon・Misskey のアカウントでのログイン・新規登録。サーバーを選ぶと、そのサーバーの認証画面へ進む。
 * 登録済みかは認証の前に明かさない（外部アカウントと Ubichill のアカウントの結び付きを他人に見せない）ので、
 * ログインも新規登録も同じ認証に進み、結果に合わせて登録のダイアログかログインになる。
 */
export function FediverseSignInPanel({
    returnTo,
    featuredServers,
}: {
    returnTo: string;
    featuredServers: readonly string[];
}) {
    const headingId = useId();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const go = async (server: string) => {
        setBusy(true);
        setError('');
        try {
            // まだ登録されていなければ、そのまま登録できると添える（多いのは登録済みの人なので、ログインとして始める）
            await startFediverseSignIn({ server, intent: 'sign-in', prefer: 'sign-in', returnTo });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'ログインを始められませんでした');
            setBusy(false);
        }
    };

    return (
        <section className={panel} aria-labelledby={headingId}>
            <h2 id={headingId} className={heading}>
                <span className={logos} aria-hidden="true">
                    <MastodonLogo size={20} />
                    <MisskeyLogo size={20} />
                </span>
                Mastodon・Misskey のアカウントで
            </h2>
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
        </section>
    );
}

const panel = css({ display: 'flex', flexDirection: 'column', gap: '3', w: 'full', textAlign: 'left' });
const heading = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textMuted',
});
const logos = css({ display: 'inline-flex', gap: '1', flexShrink: 0 });
