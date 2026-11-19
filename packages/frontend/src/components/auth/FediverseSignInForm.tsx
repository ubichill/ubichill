import type { FediverseSignInIntent } from '@ubichill/shared';
import { useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';
import { errorStyle, fieldStyle, hintStyle, inputStyle, labelStyle } from './authStyles';

/**
 * Mastodon・Misskey のアカウントで続ける。普段ログインしているサーバー（またはハンドル）を入れて、そのサーバーの
 * 同意画面へ移る。種類はサーバーから判定するので選ばせない。
 */
export function FediverseSignInForm({
    intent,
    returnTo,
    submitLabel = 'フェディバースで続ける',
}: {
    intent: FediverseSignInIntent;
    returnTo: string;
    submitLabel?: string;
}) {
    const [server, setServer] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await startFediverseSignIn({ server, intent, returnTo });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'ログインを始められませんでした');
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className={formStyle} aria-busy={busy}>
            <div className={fieldStyle}>
                <label htmlFor={`fediverse-server-${intent}`} className={labelStyle}>
                    Mastodon・Misskey のサーバー
                </label>
                <input
                    id={`fediverse-server-${intent}`}
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="misskey.io / @you@mastodon.social"
                    aria-describedby={`fediverse-server-hint-${intent}`}
                    className={inputStyle}
                    required
                />
                <p id={`fediverse-server-hint-${intent}`} className={hintStyle}>
                    {intent === 'sign-in'
                        ? 'そのサーバーの画面で許可すると戻ってきます。メールアドレスは要りません'
                        : 'そのサーバーの画面で許可すると戻ってきます'}
                </p>
            </div>
            {error && (
                <p role="alert" className={errorStyle}>
                    {error}
                </p>
            )}
            <button type="submit" className={buttonStyle} disabled={busy || !server.trim()}>
                <HudIcon name="fediverse" size={18} />
                {busy ? '移動中...' : submitLabel}
            </button>
        </form>
    );
}

const formStyle = css({ display: 'flex', flexDirection: 'column', gap: '3', w: 'full' });

const buttonStyle = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2',
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
