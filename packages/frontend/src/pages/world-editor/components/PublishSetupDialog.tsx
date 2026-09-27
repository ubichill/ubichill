import { displayAuthorAccount } from '@ubichill/shared';
import { useRef, useState } from 'react';
import type { MyAccount } from '@/lib/account/me';
import {
    createKeyWithBackup,
    importKeyFile,
    KEY_BACKUP_FILENAME,
    loadSigningKey,
    REPLACE_KEY_MESSAGE,
    signerFor,
} from '@/lib/signing';
import { css } from '@/styled-system/css';
import type { PendingPublishSetup } from '../hooks/usePublishSetup';
import { Modal } from './Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './ModalButtons';

const paragraph = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.7', mb: '3' });
const actions = css({ display: 'flex', flexDirection: 'column', gap: '2', mt: '2' });

/**
 * 保存時に公開（作者署名）できないときの案内。プロフィールへ探しに行かせず、この場で
 * 鍵の作成・読み込み（＝復旧）をして公開するか、非公開で保存するかを選ばせる。
 */
export function PublishSetupDialog({ readiness, account, finish }: PendingPublishSetup) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // 別の鍵がアカウントに登録済みのとき、置き換えてよいかをダイアログ内で確認する
    const [replacePrompt, setReplacePrompt] = useState<((ok: boolean) => void) | null>(null);
    const confirmReplace = () => new Promise<boolean>((resolve) => setReplacePrompt(() => resolve));

    const publishWith = async (prepare: () => Promise<MyAccount | null>) => {
        setBusy(true);
        setError('');
        try {
            const updated = (await prepare()) ?? account;
            const signer = signerFor(await loadSigningKey(), updated);
            if (!signer) throw new Error('鍵を用意できませんでした');
            finish({ kind: 'signed', signer });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    const hasKeyElsewhere = !!account?.signingPublicKey;
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

    return (
        <Modal open onClose={() => finish({ kind: 'cancel' })} title="ワールドを公開する" width="560px" footer={footer}>
            <p className={paragraph}>
                公開するワールドには、あなたの鍵で「作者署名」を付けます。署名があると、改竄されていないこと
                {account?.author ? `・${displayAuthorAccount(account.author)} が作ったこと` : ''}
                を他のサーバーでも確認できます。署名のないワールドは一覧に表示されません。
            </p>
            <p className={paragraph}>
                鍵はこのブラウザにだけ保存され、サーバーには送られません。作成すると {KEY_BACKUP_FILENAME}{' '}
                がダウンロードされます。
                <strong>別の端末やブラウザではこのファイルを読み込むと、同じ作者として公開できます。</strong>
                無くすと以後は別の作者として扱われるので、安全な場所に保管してください。
            </p>
            {account && !account.handle && (
                <p className={paragraph}>
                    プロフィールで ID
                    を設定すると、作者として「@ID@サーバー」が表示されます（あとからでも設定できます）。
                </p>
            )}

            {replacePrompt ? (
                <div className={actions}>
                    <p className={css({ fontSize: '13px', color: 'errorText', lineHeight: '1.7' })}>
                        {REPLACE_KEY_MESSAGE}
                    </p>
                    <ModalPrimaryButton onClick={() => replacePrompt(true)}>置き換えて公開</ModalPrimaryButton>
                    <ModalSecondaryButton onClick={() => replacePrompt(false)}>置き換えない</ModalSecondaryButton>
                </div>
            ) : (
                <div className={actions}>
                    {hasKeyElsewhere ? (
                        <>
                            <p className={paragraph}>
                                このアカウントには鍵が登録済みです。以前ダウンロードした {KEY_BACKUP_FILENAME}{' '}
                                を読み込んでください。
                            </p>
                            <ModalPrimaryButton disabled={busy} onClick={() => fileInput.current?.click()}>
                                鍵ファイルを読み込んで公開
                            </ModalPrimaryButton>
                            <ModalSecondaryButton
                                disabled={busy}
                                onClick={() => void publishWith(() => createKeyWithBackup(account, confirmReplace))}
                            >
                                鍵ファイルが無い: 新しい鍵を作って公開（以前の作者表示は引き継がれません）
                            </ModalSecondaryButton>
                        </>
                    ) : (
                        <>
                            <ModalPrimaryButton
                                disabled={busy}
                                onClick={() => void publishWith(() => createKeyWithBackup(account, confirmReplace))}
                            >
                                鍵を作成して公開
                            </ModalPrimaryButton>
                            <ModalSecondaryButton disabled={busy} onClick={() => fileInput.current?.click()}>
                                鍵ファイルを持っている: 読み込んで公開
                            </ModalSecondaryButton>
                        </>
                    )}
                </div>
            )}
            {error && <p className={css({ mt: '3', fontSize: '13px', color: 'errorText' })}>{error}</p>}
            <input
                ref={fileInput}
                type="file"
                accept=".key,text/plain"
                className={css({ display: 'none' })}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void publishWith(() => importKeyFile(file, account, confirmReplace));
                }}
            />
        </Modal>
    );
}
