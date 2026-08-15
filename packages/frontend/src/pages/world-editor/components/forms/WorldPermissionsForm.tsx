import { css } from '@/styled-system/css';
import { PanelSection } from '../PanelSection';

export interface WorldPermissions {
    allowGuestCreate: boolean;
    allowGuestDelete: boolean;
}

interface WorldPermissionsFormProps {
    permissions: WorldPermissions;
    onChange: (next: WorldPermissions) => void;
}

/**
 * コントロールパネルの「公開設定」タブの中身。
 * 未ログイン（ゲスト）ユーザーに許可する操作を definition.spec.permissions へ直接反映する。
 */
export function WorldPermissionsForm({ permissions, onChange }: WorldPermissionsFormProps) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <PanelSection title="ゲスト権限">
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    未ログイン（ゲスト）ユーザーがこのワールドで実行できる操作を制御します。
                </p>
                <Toggle
                    label="ゲストにエンティティ作成を許可"
                    checked={permissions.allowGuestCreate}
                    onChange={(value) => onChange({ ...permissions, allowGuestCreate: value })}
                />
                <Toggle
                    label="ゲストにエンティティ削除を許可"
                    checked={permissions.allowGuestDelete}
                    onChange={(value) => onChange({ ...permissions, allowGuestDelete: value })}
                />
            </PanelSection>
        </div>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className={css({ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' })}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className={css({ width: '16px', height: '16px' })}
            />
            <span className={css({ fontSize: '13px', color: 'text' })}>{label}</span>
        </label>
    );
}
