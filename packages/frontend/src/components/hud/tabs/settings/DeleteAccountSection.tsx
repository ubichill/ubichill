import { useSocket } from '@ubichill/react';
import type { LoginMethods } from '@ubichill/shared';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { deleteMyAccount, signOutThisAccount } from '@/lib/account/accountSwitch';
import { css } from '@/styled-system/css';
import { settingsPath } from '../../settingsLink';
import { ReauthPrompt } from './ReauthPrompt';
import { settingsNote } from './settingsStyles';

/**
 * アカウントの削除（退会）。取り消せないので、直近の本人確認・ID の入れ直し・確認のダイアログを経る。
 * 消した後は `/` へ移る（このブラウザーで覚えているほかのアカウントがあればそのホーム、無ければ紹介のページ）。
 */
export function DeleteAccountSection({
    handle,
    official,
    methods,
    onReauthenticated,
}: {
    handle: string;
    official: boolean;
    methods: LoginMethods | null;
    onReauthenticated: () => void;
}) {
    const { leaveWorld } = useSocket();
    const confirm = useConfirm();
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (official) {
        return (
            <section className={card}>
                <h2 className={heading}>アカウントを削除</h2>
                <p className={settingsNote}>公式アカウントは削除できません。</p>
            </section>
        );
    }

    const submit = async () => {
        if (!(await confirm(`@${handle} を削除しますか？元に戻せません。`))) return;
        setBusy(true);
        setError('');
        try {
            await leaveWorld().catch(() => undefined);
            await deleteMyAccount(typed.trim());
            // 消したアカウントのセッションは無くなっている。ほかに覚えているアカウントがあればそちらへ
            await signOutThisAccount().catch(() => null);
            window.location.assign('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : '削除できませんでした');
            setBusy(false);
        }
    };

    const recent = methods?.recentlyAuthenticated ?? false;

    return (
        <section className={card}>
            <h2 className={heading}>アカウントを削除</h2>
            <p className={settingsNote}>
                ワールド・部屋・フレンド・プロフィール・ログイン方法がすべて消え、元に戻せません。ID @{handle}
                は二度と使えなくなります。
            </p>
            {!recent ? (
                <ReauthPrompt
                    methods={methods}
                    action="削除"
                    returnTo={settingsPath('account')}
                    onDone={onReauthenticated}
                />
            ) : (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    <label className={settingsNote} htmlFor="delete-account-handle">
                        確認のため、ID（{handle}）を入力してください
                    </label>
                    <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap', alignItems: 'center' })}>
                        <input
                            id="delete-account-handle"
                            type="text"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            className={input}
                        />
                        <button
                            type="button"
                            className={dangerButton}
                            disabled={busy || typed.trim() !== handle}
                            onClick={() => void submit()}
                        >
                            {busy ? '削除しています...' : '削除する'}
                        </button>
                    </div>
                    {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
                </div>
            )}
        </section>
    );
}

const card = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    p: '4',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'errorText',
    borderRadius: '12px',
});

const heading = css({ fontSize: 'lg', fontWeight: '700', color: 'errorText' });

const input = css({
    flex: '1 1 200px',
    maxW: '320px',
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    fontSize: '14px',
    bg: 'background',
    color: 'text',
});

const dangerButton = css({
    px: '4',
    py: '2',
    bg: 'error',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
