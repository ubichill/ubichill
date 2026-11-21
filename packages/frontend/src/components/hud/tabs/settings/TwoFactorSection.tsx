import type { LoginMethods, TwoFactorStatus } from '@ubichill/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { disableTwoFactor, fetchTwoFactorStatus, regenerateBackupCodes } from '@/lib/account/twoFactor';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { BackupCodesView } from './BackupCodesView';
import {
    settingsCard,
    settingsCardTitle,
    settingsInput,
    settingsLabel,
    settingsNote,
    settingsOutlineButton,
    settingsTextButton,
    settingsWideButton,
} from './settingsStyles';
import { TwoFactorSetupDialog } from './TwoFactorSetupDialog';

type Open = 'setup' | 'disable' | 'regenerate' | { codes: string[] } | null;

/** バックアップコードの残りがこれ以下なら、作り直しを促す */
const FEW_BACKUP_CODES = 3;

/**
 * 二段階認証（設定の「アカウント」）。有効にすると、パスワードでもフェディバースでも、ログインのたびに認証アプリの
 * コードを求める。無効にする・バックアップコードを作り直すには今のコードが要る。
 */
export function TwoFactorSection({
    methods,
    onReauthenticated,
}: {
    methods: LoginMethods | null;
    onReauthenticated: () => void;
}) {
    const [status, setStatus] = useState<TwoFactorStatus | null>(null);
    const [error, setError] = useState('');
    const [open, setOpen] = useState<Open>(null);

    const load = useCallback(() => {
        fetchTwoFactorStatus()
            .then(setStatus)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
    }, []);

    useEffect(load, [load]);

    return (
        <section className={settingsCard}>
            <h2 className={settingsCardTitle}>二段階認証</h2>
            {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
            {status?.enabled ? (
                <>
                    <p
                        className={css({
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2',
                            fontSize: '13px',
                            color: 'text',
                        })}
                    >
                        <span className={tag}>有効</span>
                        ログインのたびに認証アプリのコードを求めます。
                    </p>
                    <p className={status.backupCodesLeft <= FEW_BACKUP_CODES ? warning : settingsNote}>
                        バックアップコードの残り: {status.backupCodesLeft} 個
                        {status.backupCodesLeft <= FEW_BACKUP_CODES && '。作り直しておいてください'}
                    </p>
                    <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                        <button type="button" className={settingsOutlineButton} onClick={() => setOpen('regenerate')}>
                            バックアップコードを作り直す
                        </button>
                        <button type="button" className={settingsOutlineButton} onClick={() => setOpen('disable')}>
                            無効にする
                        </button>
                    </div>
                </>
            ) : (
                status && (
                    <>
                        <p className={settingsNote}>
                            パスワードやフェディバースのアカウントに加えて、認証アプリのコードでログインを確かめます。
                            パスワードやアカウントが他人に知られても、ログインされにくくなります。
                        </p>
                        <button type="button" className={settingsOutlineButton} onClick={() => setOpen('setup')}>
                            設定する
                        </button>
                    </>
                )
            )}

            {open === 'setup' && (
                <TwoFactorSetupDialog
                    methods={methods}
                    onClose={() => setOpen(null)}
                    onEnabled={load}
                    onReauthenticated={onReauthenticated}
                />
            )}
            {open === 'disable' && (
                <CodeDialog
                    title="二段階認証を無効にする"
                    description="無効にすると、ログインのときに認証アプリのコードを求めなくなります。"
                    submitLabel="無効にする"
                    onClose={() => setOpen(null)}
                    onSubmit={async (code) => {
                        await disableTwoFactor(code);
                        setOpen(null);
                        pushToast('二段階認証を無効にしました', 'info');
                        load();
                    }}
                />
            )}
            {open === 'regenerate' && (
                <CodeDialog
                    title="バックアップコードを作り直す"
                    description="作り直すと、今までのバックアップコードは使えなくなります。"
                    submitLabel="作り直す"
                    onClose={() => setOpen(null)}
                    onSubmit={async (code) => {
                        setOpen({ codes: await regenerateBackupCodes(code) });
                        load();
                    }}
                />
            )}
            {typeof open === 'object' && open !== null && (
                <Dialog open title="新しいバックアップコード" onClose={() => setOpen(null)}>
                    <BackupCodesView codes={open.codes} />
                    <button type="button" className={settingsWideButton} onClick={() => setOpen(null)}>
                        保存しました
                    </button>
                </Dialog>
            )}
        </section>
    );
}

/** 今のコード（認証アプリかバックアップコード）を入れて確かめる操作のダイアログ。 */
function CodeDialog({
    title,
    description,
    submitLabel,
    onClose,
    onSubmit,
}: {
    title: string;
    description: string;
    submitLabel: string;
    onClose: () => void;
    onSubmit: (code: string) => Promise<void>;
}) {
    const id = useId();
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await onSubmit(code.trim());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'うまくいきませんでした');
            setCode('');
            setBusy(false);
        }
    };

    return (
        <Dialog open title={title} onClose={onClose}>
            <form onSubmit={submit} className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                <p className={settingsNote}>{description}</p>
                <label htmlFor={`${id}-code`} className={settingsLabel}>
                    認証アプリのコード（またはバックアップコード）
                    <input
                        id={`${id}-code`}
                        className={settingsInput}
                        autoComplete="one-time-code"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={13}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                    />
                </label>
                {error && <p className={css({ fontSize: '12px', color: 'errorText' })}>{error}</p>}
                <button type="submit" className={settingsWideButton} disabled={busy || code.trim().length < 6}>
                    {busy ? '確かめています...' : submitLabel}
                </button>
                <button type="button" className={settingsTextButton} disabled={busy} onClick={onClose}>
                    やめる
                </button>
            </form>
        </Dialog>
    );
}

const tag = css({
    flexShrink: 0,
    px: '1.5',
    py: '0.5',
    fontSize: '11px',
    fontWeight: '700',
    color: 'textOnPrimary',
    bg: 'primary',
    borderRadius: '4px',
});

const warning = css({ fontSize: '12px', color: 'errorText', lineHeight: '1.6' });
