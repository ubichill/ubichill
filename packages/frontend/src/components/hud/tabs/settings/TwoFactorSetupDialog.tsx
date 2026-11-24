import type { LoginMethods, TwoFactorSetup } from '@ubichill/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { QrCode } from '@/components/ui/QrCode';
import { beginTwoFactorSetup, enableTwoFactor } from '@/lib/account/twoFactor';
import { css } from '@/styled-system/css';
import { settingsPath } from '../../settingsLink';
import { BackupCodesView } from './BackupCodesView';
import { ReauthPrompt } from './ReauthPrompt';
import { settingsInput, settingsLabel, settingsNote, settingsTextButton, settingsWideButton } from './settingsStyles';

type Step =
    | { step: 'loading' }
    | { step: 'reauth' }
    | { step: 'scan'; setup: TwoFactorSetup }
    | { step: 'codes'; codes: string[] };

/**
 * 二段階認証の設定（本人確認 → 認証アプリで QR を読む → 表示されたコードで確かめる → バックアップコードを保存）。
 * 開くたびに新しい鍵を作る（途中で閉じた鍵は使われない）。
 */
export function TwoFactorSetupDialog({
    methods,
    onClose,
    onEnabled,
    onReauthenticated,
}: {
    methods: LoginMethods | null;
    onClose: () => void;
    onEnabled: () => void;
    onReauthenticated: () => void;
}) {
    const id = useId();
    const [state, setState] = useState<Step>({ step: 'loading' });
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const start = useCallback(async () => {
        setState({ step: 'loading' });
        setError('');
        try {
            const setup = await beginTwoFactorSetup();
            setState(setup === 'reauth-required' ? { step: 'reauth' } : { step: 'scan', setup });
        } catch (err) {
            setError(err instanceof Error ? err.message : '始められませんでした');
        }
    }, []);

    useEffect(() => {
        void start();
    }, [start]);

    const enable = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const codes = await enableTwoFactor(code);
            setState({ step: 'codes', codes });
            onEnabled();
        } catch (err) {
            setError(err instanceof Error ? err.message : '有効にできませんでした');
            setCode('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open title={state.step === 'codes' ? 'バックアップコード' : '二段階認証を設定'} onClose={onClose}>
            {state.step === 'loading' && !error && <p className={settingsNote}>準備しています...</p>}

            {state.step === 'reauth' && (
                <ReauthPrompt
                    methods={methods}
                    action="設定"
                    returnTo={settingsPath('account')}
                    onDone={() => {
                        onReauthenticated();
                        void start();
                    }}
                />
            )}

            {state.step === 'scan' && (
                <form onSubmit={enable} className={stack}>
                    <p className={settingsNote}>
                        1. 認証アプリ（Google Authenticator・Microsoft Authenticator・1Password など）で、この QR
                        コードを読み取ってください。
                    </p>
                    <QrCode text={state.setup.uri} label="認証アプリに登録する QR コード" />
                    <details className={settingsNote}>
                        <summary className={css({ cursor: 'pointer' })}>読み取れないとき</summary>
                        <p className={css({ mt: '2' })}>認証アプリに次のキーを入力してください（時間ベース）。</p>
                        <code className={secretStyle}>{state.setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
                        <a href={state.setup.uri} className={css({ color: 'text', textDecoration: 'underline' })}>
                            この端末の認証アプリで開く
                        </a>
                    </details>
                    <label htmlFor={`${id}-code`} className={settingsLabel}>
                        2. 認証アプリに表示された 6 桁のコード
                        <input
                            id={`${id}-code`}
                            className={settingsInput}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                    </label>
                    {error && <p className={errorText}>{error}</p>}
                    <button type="submit" className={settingsWideButton} disabled={busy || code.length !== 6}>
                        {busy ? '確かめています...' : '有効にする'}
                    </button>
                </form>
            )}

            {state.step === 'codes' && (
                <div className={stack}>
                    <p className={settingsNote}>
                        二段階認証を有効にしました。これからはログインのたびに認証アプリのコードを求めます。
                    </p>
                    <BackupCodesView codes={state.codes} />
                    <button type="button" className={settingsWideButton} onClick={onClose}>
                        保存しました
                    </button>
                </div>
            )}

            {state.step !== 'scan' && error && <p className={errorText}>{error}</p>}
            {state.step !== 'codes' && (
                <button type="button" className={settingsTextButton} disabled={busy} onClick={onClose}>
                    やめる
                </button>
            )}
        </Dialog>
    );
}

const stack = css({ display: 'flex', flexDirection: 'column', gap: '3' });
const errorText = css({ fontSize: '12px', color: 'errorText' });
const secretStyle = css({
    display: 'block',
    my: '2',
    p: '2',
    fontFamily: 'mono',
    fontSize: '13px',
    color: 'text',
    bg: 'background',
    borderRadius: '6px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
});
