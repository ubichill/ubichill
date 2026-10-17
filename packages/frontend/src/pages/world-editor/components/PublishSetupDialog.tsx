import { css } from '@/styled-system/css';
import type { PendingPublishSetup } from '../hooks/usePublishSetup';
import { Modal } from './Modal';
import { ModalSecondaryButton } from './ModalButtons';

const paragraph = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.7', mb: '3' });

/**
 * 公開・保存できないときの案内。鍵の用意と公開環境の登録は自動なので、利用者に求めるものは無く、
 * 固定できない mod がある・アカウントを取れないときに、その理由だけを伝える。
 */
export function PublishSetupDialog({ readiness, purpose, finish }: PendingPublishSetup) {
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
