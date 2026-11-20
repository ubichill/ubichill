import { useId, useState } from 'react';
import { useFediverseServer } from '@/lib/account/fediverseSignIn';
import { css, cva } from '@/styled-system/css';
import { fieldErrorStyle, fieldStyle, hintStyle, inputStyle, labelStyle } from './authStyles';
import { FediverseServerCard } from './FediverseServerCard';

/**
 * ログインに使うサーバーを選ぶ。よく使われるサーバーは押すとそのままそのサーバーの認証画面へ進む。
 * 「その他のサーバー」はドメインを入れ、サーバーを確かめられたら進むボタンを出す。
 */
export function FediverseServerPicker({
    featuredServers,
    busy,
    confirmLabel,
    onChoose,
}: {
    featuredServers: readonly string[];
    busy: boolean;
    /** その他のサーバーを確かめた後のボタンの文言 */
    confirmLabel: string;
    onChoose: (host: string) => void;
}) {
    const [other, setOther] = useState(false);
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2', w: 'full' })}>
            {featuredServers.map((host) => (
                <FeaturedServer key={host} host={host} busy={busy} onChoose={onChoose} />
            ))}
            {other ? (
                <OtherServer busy={busy} confirmLabel={confirmLabel} onChoose={onChoose} />
            ) : (
                <button
                    type="button"
                    className={choice({ muted: true })}
                    disabled={busy}
                    onClick={() => setOther(true)}
                >
                    その他のサーバー
                </button>
            )}
        </div>
    );
}

function FeaturedServer({ host, busy, onChoose }: { host: string; busy: boolean; onChoose: (host: string) => void }) {
    const server = useFediverseServer(host, 0);
    // 使えないと分かったサーバー（未対応・許可外）は並べない。接続できないだけなら押せるまま残す
    if (server.state === 'error' && server.code !== 'server-unreachable' && server.code !== null) return null;
    return (
        <button type="button" className={choice()} disabled={busy} onClick={() => onChoose(host)}>
            <FediverseServerCard host={host} server={server.state === 'found' ? server.server : null} size="sm" />
        </button>
    );
}

function OtherServer({
    busy,
    confirmLabel,
    onChoose,
}: {
    busy: boolean;
    confirmLabel: string;
    onChoose: (host: string) => void;
}) {
    const id = useId();
    const [domain, setDomain] = useState('');
    const server = useFediverseServer(domain, 500);
    return (
        <div className={fieldStyle}>
            <label htmlFor={id} className={labelStyle}>
                サーバーのドメイン
            </label>
            <input
                id={id}
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                // biome-ignore lint/a11y/noAutofocus: 「その他のサーバー」を押して開いた入力なので、すぐ打てるようにする
                autoFocus
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="misskey.example"
                aria-describedby={`${id}-status`}
                aria-invalid={server.state === 'error'}
                className={inputStyle}
            />
            <div id={`${id}-status`} role="status">
                {server.state === 'checking' && <p className={hintStyle}>確認中...</p>}
                {server.state === 'error' && <p className={fieldErrorStyle}>{server.error}</p>}
            </div>
            {server.state === 'found' && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '3', w: 'full', mt: '1' })}>
                    <div className={selected}>
                        <FediverseServerCard host={server.server.host} server={server.server} />
                    </div>
                    <button
                        type="button"
                        className={confirm}
                        disabled={busy}
                        onClick={() => onChoose(server.server.host)}
                    >
                        {confirmLabel}
                    </button>
                </div>
            )}
        </div>
    );
}

const choice = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        w: 'full',
        minH: '52px',
        px: '3',
        py: '2',
        bg: 'white',
        border: '1px solid',
        borderColor: 'border',
        rounded: 'lg',
        cursor: 'pointer',
        transition: 'all 0.2s',
        _hover: { bg: 'surfaceHover' },
        _focusVisible: { outline: '2px solid token(colors.primary)', outlineOffset: '2px' },
        _disabled: { opacity: 0.6, cursor: 'not-allowed' },
    },
    variants: {
        muted: { true: { fontSize: 'sm', fontWeight: 'medium', color: 'textMuted', bg: 'surface' } },
    },
});

const selected = css({ p: '3', bg: 'surface', border: '1px solid', borderColor: 'border', rounded: 'lg' });

const confirm = css({
    w: 'full',
    minH: '44px',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    color: 'textOnPrimary',
    bg: 'primaryHover',
    rounded: 'lg',
    cursor: 'pointer',
    _hover: { bg: 'primaryActive' },
    _disabled: { opacity: 0.6, cursor: 'not-allowed' },
});
