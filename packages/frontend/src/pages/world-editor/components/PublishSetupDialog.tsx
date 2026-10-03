import { useState } from 'react';
import { setMyHandle } from '@/lib/account/me';
import { useHandleAvailability } from '@/lib/account/useHandleAvailability';
import { css } from '@/styled-system/css';
import type { PendingPublishSetup } from '../hooks/usePublishSetup';
import { Modal } from './Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './ModalButtons';

const paragraph = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.7', mb: '3' });

/**
 * 公開時に足りないものの案内。鍵の用意と公開環境の登録は自動なので、利用者に求めるのは ID だけ。
 * 固定できない mod がある・アカウントを取れないときは、公開できない理由だけを伝える。
 */
export function PublishSetupDialog({ readiness, purpose, finish }: PendingPublishSetup) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [handleInput, setHandleInput] = useState('');
    const handleStatus = useHandleAvailability(handleInput, readiness.kind === 'needs-handle');
    const cancel = () => finish({ kind: 'cancel' });
    const cancelButton = <ModalSecondaryButton onClick={cancel}>キャンセル</ModalSecondaryButton>;

    if (readiness.kind === 'unpinned') {
        return (
            <Modal open onClose={cancel} title="このままでは公開できません" width="520px" footer={cancelButton}>
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
                <p className={paragraph}>
                    公開せずに作業を続けるなら「下書き保存」を使ってください（準備は不要です）。
                </p>
            </Modal>
        );
    }

    if (readiness.kind === 'no-account') {
        return (
            <Modal
                open
                onClose={cancel}
                title={purpose === 'publish' ? '公開できません' : '保存できません'}
                width="480px"
                footer={cancelButton}
            >
                <p className={paragraph}>
                    アカウント情報を取得できないため、ワールドの URL を決められません。時間をおいて再度お試しください。
                </p>
            </Modal>
        );
    }

    const { account } = readiness;
    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await setMyHandle(handleInput.trim());
            finish({ kind: 'continue', account: { ...account, handle: result.handle, author: result.author } });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={cancel}
            title={purpose === 'publish' ? 'ID を決めて公開する' : 'ID を決めて保存する'}
            width="520px"
            footer={
                <>
                    {cancelButton}
                    <ModalPrimaryButton
                        disabled={busy || handleStatus.state !== 'available'}
                        onClick={() => void submit()}
                    >
                        {purpose === 'publish' ? 'この ID で公開する' : 'この ID で保存する'}
                    </ModalPrimaryButton>
                </>
            }
        >
            <p className={paragraph}>
                ワールドの URL
                は「/@ID/名前」になり、公開するときは作者アカウント「@ID@サーバー」で署名します。ほかのサーバーでも、
                改竄されていないこと・あなたが作ったことを確認できるようになります。ID は英小文字・数字・_ の 3〜30
                文字で、あとから変更できません。
            </p>
            <input
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value.toLowerCase().slice(0, 30))}
                aria-label="ID"
                autoCapitalize="none"
                spellCheck={false}
                className={css({
                    width: '100%',
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
            {'error' in handleStatus && (
                <p className={css({ mt: '1', fontSize: '12px', color: 'errorText' })}>{handleStatus.error}</p>
            )}
            {error && <p className={css({ mt: '3', fontSize: '13px', color: 'errorText' })}>{error}</p>}
        </Modal>
    );
}
