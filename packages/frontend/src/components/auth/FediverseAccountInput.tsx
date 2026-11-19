import type { FediversePreview } from '@ubichill/shared';
import { type ReactNode, useId, useState } from 'react';
import { useFediverseLookup } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';
import { fieldErrorStyle, fieldStyle, hintStyle, inputStyle, labelStyle } from './authStyles';
import { FediversePreviewCard } from './FediversePreviewCard';

/**
 * Mastodon・Misskey のユーザー ID を入れると、そのサーバーとアカウントを出して確かめさせる。
 * 確かめられたら `actions` に問い合わせの結果を渡して、ログイン・新規登録・追加のボタンを出す。
 */
export function FediverseAccountInput({
    actions,
    autoFocus = false,
}: {
    actions: (preview: FediversePreview) => ReactNode;
    autoFocus?: boolean;
}) {
    const id = useId();
    const [account, setAccount] = useState('');
    const lookup = useFediverseLookup(account);

    return (
        <div className={fieldStyle}>
            <label htmlFor={id} className={labelStyle}>
                ユーザー ID
            </label>
            <input
                id={id}
                type="text"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                // biome-ignore lint/a11y/noAutofocus: ボタンを押して開いた入力なので、すぐ打てるようにする
                autoFocus={autoFocus}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="@you@misskey.io"
                aria-describedby={`${id}-status`}
                aria-invalid={lookup.state === 'error'}
                className={inputStyle}
            />
            <div id={`${id}-status`} role="status">
                {lookup.state === 'checking' && <p className={hintStyle}>確認中...</p>}
                {lookup.state === 'error' && <p className={fieldErrorStyle}>{lookup.error}</p>}
            </div>
            {lookup.state === 'found' && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '3', w: 'full', mt: '1' })}>
                    <FediversePreviewCard preview={lookup.preview} />
                    {actions(lookup.preview)}
                </div>
            )}
        </div>
    );
}
