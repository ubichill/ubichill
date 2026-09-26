import { displayAuthorAccount } from '@ubichill/shared';
import { useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { type MyAccount, registerSigningKey, setMyHandle } from '@/lib/account/me';
import { useHandleAvailability } from '@/lib/account/useHandleAvailability';
import {
    createSigningKey,
    importSigningKeyBackup,
    loadSigningKey,
    removeSigningKey,
    useSigningPublicKey,
} from '@/lib/signing';
import { css, cva } from '@/styled-system/css';

const BACKUP_FILENAME = 'ubichill-signing.key';

const button = cva({
    base: {
        padding: '8px 14px',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { opacity: 0.9 } },
            secondary: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
            danger: { bg: 'surface', color: 'errorText', borderColor: 'border', _hover: { bg: 'errorBg' } },
        },
    },
});

const notice = cva({
    base: { fontSize: '13px', px: '3', py: '2', borderRadius: '8px', mb: '3', lineHeight: '1.6' },
    variants: {
        tone: {
            warn: { color: 'errorText', bg: 'errorBg' },
            info: { color: 'textMuted', bg: 'surfaceAccent' },
        },
    },
});

const row = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' });

function downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** 鍵の状態（このブラウザの鍵 × アカウントの登録鍵）。 */
type KeyState = 'none' | 'registered' | 'unregistered' | 'mismatch';

function keyStateOf(localKey: string | null, registeredKey: string | null): KeyState {
    if (!localKey) return 'none';
    if (!registeredKey) return 'unregistered';
    return localKey === registeredKey ? 'registered' : 'mismatch';
}

interface SigningKeySectionProps {
    account: MyAccount;
    onAccountChange: (next: MyAccount) => void;
    unsignedCount: number;
}

/**
 * 作者署名の設定。ID（handle）を決め、このブラウザで作った鍵をアカウントに 1 本登録する。
 * 秘密鍵はこのブラウザ（このサイト）にだけ保存し、サーバーには公開鍵と所有の証明だけを送る。
 */
export function SigningKeySection({ account, onAccountChange, unsignedCount }: SigningKeySectionProps) {
    const localKey = useSigningPublicKey();
    const confirm = useConfirm();
    const fileInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
    const [handleInput, setHandleInput] = useState('');
    const handleStatus = useHandleAvailability(handleInput, !account.handle);

    const run = async (task: () => Promise<string | null>) => {
        setBusy(true);
        setMessage(null);
        try {
            const text = await task();
            if (text) setMessage({ tone: 'info', text });
        } catch (e) {
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    /** このブラウザの鍵をアカウントに登録する。別の鍵が登録済みなら置き換えの確認を取る。 */
    const registerLocalKey = async (): Promise<string | null> => {
        const key = await loadSigningKey();
        if (!key) return null;
        if (account.signingPublicKey && account.signingPublicKey !== key.publicKey) {
            const ok = await confirm(
                'アカウントには別の鍵が登録されています。このブラウザの鍵に置き換えると、以前の鍵で署名したワールドは作者表示が外れます（署名し直すと戻ります）。置き換えますか？',
            );
            if (!ok) return null;
        }
        await registerSigningKey(account.id, key);
        onAccountChange({ ...account, signingPublicKey: key.publicKey });
        return '鍵をアカウントに登録しました。';
    };

    const create = () =>
        run(async () => {
            const { backup } = await createSigningKey();
            downloadText(BACKUP_FILENAME, `${backup}\n`);
            const registered = await registerLocalKey();
            return `鍵を作成し ${BACKUP_FILENAME} をダウンロードしました。無くすと作者表示を引き継げません。${registered ?? ''}`;
        });

    const importFile = (file: File) =>
        run(async () => {
            await importSigningKeyBackup(await file.text());
            return `鍵を読み込みました。${(await registerLocalKey()) ?? ''}`;
        });

    const remove = async () => {
        if (!(await confirm('このブラウザから鍵を削除しますか？バックアップファイルが無いと元に戻せません。'))) return;
        await run(async () => {
            await removeSigningKey();
            return '鍵を削除しました。';
        });
    };

    const saveHandle = () =>
        run(async () => {
            const ok = await confirm(
                `ID を「${handleInput.trim()}」にします。あとから変更できません。よろしいですか？`,
            );
            if (!ok) return null;
            const result = await setMyHandle(handleInput.trim());
            onAccountChange({ ...account, handle: result.handle, author: result.author });
            return 'ID を設定しました。';
        });

    if (localKey === undefined) return null;
    const state = keyStateOf(localKey, account.signingPublicKey);

    return (
        <section
            className={css({
                mb: '6',
                p: '4',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '12px',
            })}
        >
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' })}>作者署名</h2>
            <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' })}>
                保存したワールドにあなたのアカウントで署名し、改竄されていないこと・あなたが作ったことを他のサーバーでも確認できるようにします。
                鍵はこのブラウザ（このサイト）にだけ保存され、サーバーには公開鍵だけが登録されます。署名のないワールドは一覧に公開されません。
            </p>

            {account.author ? (
                <p className={css({ fontSize: '14px', color: 'text', mb: '3' })}>
                    作者アカウント: <strong>{displayAuthorAccount(account.author)}</strong>
                </p>
            ) : (
                <div className={css({ mb: '4' })}>
                    <p className={notice({ tone: 'warn' })}>
                        ID が未設定です。作者として署名するには ID（英小文字・数字・_ の 3〜30
                        文字、変更不可）を決めてください。
                    </p>
                    <div className={row}>
                        <input
                            value={handleInput}
                            onChange={(e) => setHandleInput(e.target.value.toLowerCase().slice(0, 30))}
                            placeholder="youkan"
                            aria-label="ID"
                            autoCapitalize="none"
                            spellCheck={false}
                            className={css({
                                px: '3',
                                py: '2',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                fontSize: '14px',
                                bg: 'background',
                                color: 'text',
                            })}
                        />
                        <button
                            type="button"
                            className={button({ tone: 'primary' })}
                            disabled={busy || handleStatus.state !== 'available'}
                            onClick={() => void saveHandle()}
                        >
                            ID を設定
                        </button>
                    </div>
                    {'error' in handleStatus && (
                        <p className={css({ mt: '1', fontSize: '12px', color: 'errorText' })}>{handleStatus.error}</p>
                    )}
                </div>
            )}

            {state === 'none' && (
                <p className={notice({ tone: 'warn' })}>
                    このブラウザに鍵がありません。保存したワールドは署名されず、一覧に公開されません。
                    {unsignedCount > 0 && ` 現在 ${unsignedCount} 個のワールドが非公開です。`}
                    {account.signingPublicKey &&
                        ' 以前に作った鍵のバックアップファイルを読み込むと、同じ作者として署名できます。'}
                </p>
            )}
            {state === 'unregistered' && (
                <p className={notice({ tone: 'warn' })}>
                    このブラウザの鍵はアカウントに登録されていません。登録するまで作者アカウントは表示されません。
                </p>
            )}
            {state === 'mismatch' && (
                <p className={notice({ tone: 'warn' })}>
                    このブラウザの鍵は、アカウントに登録されている鍵と違います。登録済みの鍵のバックアップを読み込むか、この鍵に置き換えてください。
                </p>
            )}
            {state === 'registered' && unsignedCount > 0 && (
                <p className={notice({ tone: 'info' })}>
                    署名のないワールドが {unsignedCount} 個あります。下の一覧の「署名して公開」で公開できます。
                </p>
            )}

            <div className={row}>
                {localKey && (
                    <code
                        title={localKey}
                        className={css({
                            fontSize: '12px',
                            color: 'textMuted',
                            bg: 'surfaceAccent',
                            px: '2',
                            py: '1',
                            borderRadius: '6px',
                        })}
                    >
                        {localKey.slice(0, 16)}…{state === 'registered' && '（登録済み）'}
                    </code>
                )}
                {(state === 'unregistered' || state === 'mismatch') && (
                    <button
                        type="button"
                        className={button({ tone: 'primary' })}
                        disabled={busy}
                        onClick={() => void run(registerLocalKey)}
                    >
                        {state === 'mismatch' ? 'この鍵に置き換える' : 'この鍵を登録'}
                    </button>
                )}
                {state === 'none' && (
                    <button
                        type="button"
                        className={button({ tone: account.signingPublicKey ? 'secondary' : 'primary' })}
                        disabled={busy}
                        onClick={() => void create()}
                    >
                        {account.signingPublicKey ? '新しい鍵を作成して置き換える' : '鍵を作成'}
                    </button>
                )}
                {(state === 'none' || state === 'mismatch') && (
                    <button
                        type="button"
                        className={button({ tone: 'secondary' })}
                        disabled={busy}
                        onClick={async () => {
                            if (
                                localKey &&
                                !(await confirm(
                                    'このブラウザの鍵を、読み込むファイルの鍵に置き換えます。よろしいですか？',
                                ))
                            )
                                return;
                            fileInput.current?.click();
                        }}
                    >
                        鍵ファイルを読み込む
                    </button>
                )}
                {localKey && (
                    <button
                        type="button"
                        className={button({ tone: 'danger' })}
                        disabled={busy}
                        onClick={() => void remove()}
                    >
                        このブラウザから削除
                    </button>
                )}
                <input
                    ref={fileInput}
                    type="file"
                    accept=".key,text/plain"
                    className={css({ display: 'none' })}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void importFile(file);
                    }}
                />
            </div>
            {message && (
                <p
                    className={css({
                        mt: '3',
                        fontSize: '13px',
                        color: message.tone === 'error' ? 'errorText' : 'textMuted',
                    })}
                >
                    {message.text}
                </p>
            )}
        </section>
    );
}
