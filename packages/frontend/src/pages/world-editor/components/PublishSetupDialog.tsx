import { displayAuthorAccount } from '@ubichill/shared';
import { useRef, useState } from 'react';
import { type MyAccount, setMyHandle } from '@/lib/account/me';
import { useHandleAvailability } from '@/lib/account/useHandleAvailability';
import {
    createKeyWithBackup,
    importKeyFile,
    KEY_BACKUP_FILENAME,
    loadSigningKey,
    REPLACE_KEY_MESSAGE,
    registerLocalKey,
    signerFor,
    useSigningPublicKey,
} from '@/lib/signing';
import { css } from '@/styled-system/css';
import type { PendingPublishSetup } from '../hooks/usePublishSetup';
import { Modal } from './Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './ModalButtons';

const paragraph = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.7', mb: '3' });
const step = css({ borderTop: '1px solid', borderColor: 'border', pt: '3', mt: '3' });
const stepTitle = css({ fontSize: '14px', fontWeight: '700', color: 'text', mb: '2' });
const actions = css({ display: 'flex', flexDirection: 'column', gap: '2' });
const done = css({ fontSize: '13px', color: 'successText' });

/**
 * 保存時に公開できないときの案内。公開には作者アカウント（ID + 登録済みの鍵）での署名が要るので、
 * プロフィールへ探しに行かせず、この場で ID の設定・鍵の作成または読み込み（＝復旧）・登録まで済ませる。
 */
export function PublishSetupDialog({ readiness, account: initialAccount, finish }: PendingPublishSetup) {
    const localKey = useSigningPublicKey();
    const fileInput = useRef<HTMLInputElement>(null);
    const [account, setAccount] = useState<MyAccount | null>(initialAccount);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [handleInput, setHandleInput] = useState('');
    const handleStatus = useHandleAvailability(handleInput, !!account && !account.handle);
    // 別の鍵がアカウントに登録済みのとき、置き換えてよいかをダイアログ内で確認する
    const [replacePrompt, setReplacePrompt] = useState<((ok: boolean) => void) | null>(null);
    const confirmReplace = () => new Promise<boolean>((resolve) => setReplacePrompt(() => resolve));

    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        setError('');
        try {
            await task();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
            setReplacePrompt(null);
        }
    };

    const footer = (
        <>
            <ModalSecondaryButton onClick={() => finish({ kind: 'cancel' })}>キャンセル</ModalSecondaryButton>
            <ModalSecondaryButton onClick={() => finish({ kind: 'private' })}>非公開で保存</ModalSecondaryButton>
        </>
    );

    if (readiness.kind === 'unpinned') {
        return (
            <Modal
                open
                onClose={() => finish({ kind: 'cancel' })}
                title="このままでは公開できません"
                width="520px"
                footer={footer}
            >
                <p className={paragraph}>
                    次の mod
                    はコードを固定（lock）できなかったため、署名しても他の人の環境で同じコードが動くことを保証できません。
                    公開するには、mod の配布元やバージョン指定を見直してください。
                </p>
                <ul className={css({ fontSize: '13px', color: 'text', pl: '5', mb: '3', listStyleType: 'disc' })}>
                    {readiness.mods.map((m) => (
                        <li key={m}>{m}</li>
                    ))}
                </ul>
                <p className={paragraph}>非公開で保存すると、URL を知っている人だけが確認付きで入れます。</p>
            </Modal>
        );
    }

    if (!account || readiness.kind === 'no-account') {
        return (
            <Modal open onClose={() => finish({ kind: 'cancel' })} title="公開できません" width="480px" footer={footer}>
                <p className={paragraph}>
                    アカウント情報を取得できないため、作者として署名できません。時間をおいて再度お試しください。
                </p>
            </Modal>
        );
    }

    const keyRegistered = !!localKey && localKey === account.signingPublicKey;
    const ready = !!account.handle && keyRegistered;
    const registered = (next: MyAccount | null) => {
        if (next) setAccount(next);
    };

    return (
        <Modal open onClose={() => finish({ kind: 'cancel' })} title="ワールドを公開する" width="560px" footer={footer}>
            <p className={paragraph}>
                公開するワールドには、あなたの作者アカウントで署名します。署名があると、改竄されていないこと・あなたが作ったことを
                他のサーバーでも確認できます。作者アカウントで署名していないワールドは一覧に表示されません。
            </p>

            <div className={step}>
                <p className={stepTitle}>1. ID</p>
                {account.author ? (
                    <p className={done}>作者アカウント: {displayAuthorAccount(account.author)}</p>
                ) : (
                    <>
                        <p className={paragraph}>
                            作者アカウント「@ID@サーバー」の ID を決めます（英小文字・数字・_ の 3〜30
                            文字、あとから変更できません）。
                        </p>
                        <div className={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                            <input
                                value={handleInput}
                                onChange={(e) => setHandleInput(e.target.value.toLowerCase().slice(0, 30))}
                                placeholder="youkan"
                                aria-label="ID"
                                autoCapitalize="none"
                                spellCheck={false}
                                className={css({
                                    flex: 1,
                                    px: '3',
                                    py: '2',
                                    border: '1px solid',
                                    borderColor: 'border',
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                    bg: 'surface',
                                    color: 'text',
                                })}
                            />
                            <ModalPrimaryButton
                                disabled={busy || handleStatus.state !== 'available'}
                                onClick={() =>
                                    void run(async () => {
                                        const result = await setMyHandle(handleInput.trim());
                                        setAccount({ ...account, handle: result.handle, author: result.author });
                                    })
                                }
                            >
                                ID を設定
                            </ModalPrimaryButton>
                        </div>
                        {'error' in handleStatus && (
                            <p className={css({ mt: '1', fontSize: '12px', color: 'errorText' })}>
                                {handleStatus.error}
                            </p>
                        )}
                    </>
                )}
            </div>

            <div className={step}>
                <p className={stepTitle}>2. 署名の鍵</p>
                {keyRegistered ? (
                    <p className={done}>このブラウザの鍵はアカウントに登録済みです</p>
                ) : replacePrompt ? (
                    <div className={actions}>
                        <p className={css({ fontSize: '13px', color: 'errorText', lineHeight: '1.7' })}>
                            {REPLACE_KEY_MESSAGE}
                        </p>
                        <ModalPrimaryButton onClick={() => replacePrompt(true)}>置き換える</ModalPrimaryButton>
                        <ModalSecondaryButton onClick={() => replacePrompt(false)}>置き換えない</ModalSecondaryButton>
                    </div>
                ) : (
                    <>
                        <p className={paragraph}>
                            鍵はこのブラウザにだけ保存され、サーバーには公開鍵だけが登録されます。作成すると{' '}
                            {KEY_BACKUP_FILENAME} がダウンロードされます。
                            <strong>
                                別の端末やブラウザではこのファイルを読み込むと、同じ作者として公開できます。
                            </strong>
                            無くすと以後の作品は作者表示を引き継げないので、安全な場所に保管してください。
                        </p>
                        <div className={actions}>
                            {localKey ? (
                                <ModalPrimaryButton
                                    disabled={busy}
                                    onClick={() =>
                                        void run(async () =>
                                            registered(await registerLocalKey(account, confirmReplace)),
                                        )
                                    }
                                >
                                    このブラウザの鍵をアカウントに登録
                                </ModalPrimaryButton>
                            ) : account.signingPublicKey ? (
                                <>
                                    <p className={paragraph}>
                                        このアカウントには鍵が登録済みです。以前ダウンロードした {KEY_BACKUP_FILENAME}{' '}
                                        を読み込んでください。
                                    </p>
                                    <ModalPrimaryButton disabled={busy} onClick={() => fileInput.current?.click()}>
                                        鍵ファイルを読み込む
                                    </ModalPrimaryButton>
                                    <ModalSecondaryButton
                                        disabled={busy}
                                        onClick={() =>
                                            void run(async () =>
                                                registered(await createKeyWithBackup(account, confirmReplace)),
                                            )
                                        }
                                    >
                                        鍵ファイルが無い: 新しい鍵を作る（以前の作者表示は引き継がれません）
                                    </ModalSecondaryButton>
                                </>
                            ) : (
                                <>
                                    <ModalPrimaryButton
                                        disabled={busy}
                                        onClick={() =>
                                            void run(async () =>
                                                registered(await createKeyWithBackup(account, confirmReplace)),
                                            )
                                        }
                                    >
                                        鍵を作成する
                                    </ModalPrimaryButton>
                                    <ModalSecondaryButton disabled={busy} onClick={() => fileInput.current?.click()}>
                                        鍵ファイルを持っている: 読み込む
                                    </ModalSecondaryButton>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>

            <div className={step}>
                <ModalPrimaryButton
                    disabled={busy || !ready}
                    onClick={() =>
                        void run(async () => {
                            const signer = signerFor(await loadSigningKey(), account);
                            if (!signer?.author) throw new Error('作者アカウントで署名する準備ができていません');
                            finish({ kind: 'signed', signer });
                        })
                    }
                >
                    作者アカウントで署名して公開
                </ModalPrimaryButton>
            </div>
            {error && <p className={css({ mt: '3', fontSize: '13px', color: 'errorText' })}>{error}</p>}
            <input
                ref={fileInput}
                type="file"
                accept=".key,text/plain"
                className={css({ display: 'none' })}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void run(async () => registered(await importKeyFile(file, account, confirmReplace)));
                }}
            />
        </Modal>
    );
}
