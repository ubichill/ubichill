import type { LoginMethods } from '@ubichill/shared';
import { useState } from 'react';
import { SoftwareLogo } from '@/components/auth/FediverseBrandIcons';
import { startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { reauthenticationWay } from '@/lib/account/loginMethods';
import { css } from '@/styled-system/css';
import { ReauthForm } from './ReauthForm';
import { settingsNote, settingsOutlineButton } from './settingsStyles';

/**
 * 直近の本人確認（10 分有効）を求める（しかたは lib/account/loginMethods.ts の reauthenticationWay）。
 * フェディバースのアカウントでログインし直したら `returnTo` へ戻る（二段階認証が有効ならコードも求められる）。
 */
export function ReauthPrompt({
    methods,
    action,
    returnTo,
    onDone,
}: {
    methods: LoginMethods | null;
    /** 何の前か（「承認」「削除」など） */
    action: string;
    /** ログインし直した後に戻る、Ubichill の中の URL */
    returnTo: string;
    onDone: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const way = reauthenticationWay(methods);
    if (way.kind === 'password') {
        return (
            <div className={stack}>
                <p className={settingsNote}>{action}の前に、パスワードで本人確認をしてください。</p>
                <ReauthForm onDone={onDone} />
            </div>
        );
    }
    if (way.kind === 'sign-in-again') {
        return <p className={settingsNote}>{action}するには、ログインし直してから 10 分以内に行ってください。</p>;
    }

    const signInAgain = async (server: string) => {
        setBusy(true);
        setError('');
        try {
            await startFediverseSignIn({ server, intent: 'sign-in', returnTo });
        } catch (err) {
            setError(err instanceof Error ? err.message : '始められませんでした');
            setBusy(false);
        }
    };

    return (
        <div className={stack}>
            <p className={settingsNote}>{action}の前に、ログインし直して本人確認をしてください。</p>
            {way.accounts.map((account) => (
                <button
                    key={account.id}
                    type="button"
                    className={settingsOutlineButton}
                    disabled={busy}
                    onClick={() => void signInAgain(account.server)}
                >
                    {account.software && <SoftwareLogo software={account.software} size={16} />}
                    {`${account.username ? `@${account.username}@${account.server}` : account.server} でログインし直す`}
                </button>
            ))}
            {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
        </div>
    );
}

const stack = css({ display: 'flex', flexDirection: 'column', gap: '2' });
