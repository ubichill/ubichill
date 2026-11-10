import { OFFICIAL_HANDLE, ROLE_LIMITS, type Role } from '@ubichill/shared';
import { useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { RoleBadge } from '@/components/profile/ProfileRoleBadges';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { Switch } from '@/components/ui/Switch';
import { createRole, deleteRole, updateRole } from '@/lib/admin/adminApi';
import { draftOf, NEW_ROLE_DRAFT, type RoleDraft, roleInputOf } from '@/lib/admin/roleForm';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { adminButton, adminError, adminField, adminLabel } from './adminStyles';

/** ロールの作成・編集。 */
export function RoleEditor({
    saved: role,
    onSaved,
    onDeleted,
}: {
    /** 保存済みのロール（null なら新しく作る） */
    saved: Role | null;
    onSaved: (role: Role) => void;
    onDeleted: () => void;
}) {
    const confirm = useConfirm();
    const [draft, setDraft] = useState<RoleDraft>(() => (role ? draftOf(role) : NEW_ROLE_DRAFT));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const checked = roleInputOf(draft);
    const set = <K extends keyof RoleDraft>(key: K, value: RoleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

    const save = async () => {
        if (!checked.ok) return;
        const grantsAdmin = checked.input.isAdministrator && !role?.isAdministrator;
        if (
            grantsAdmin &&
            role &&
            role.memberCount > 0 &&
            !(await confirm(
                `${role.memberCount} 人が管理者になります。サーバーの設定をすべて変えられます。保存しますか？`,
            ))
        ) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const saved = role ? await updateRole(role.id, checked.input) : await createRole(checked.input);
            pushToast(role ? 'ロールを保存しました' : 'ロールを作りました');
            onSaved(saved);
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存できませんでした');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!role) return;
        const members = role.memberCount > 0 ? `${role.memberCount} 人からも外れます。` : '';
        if (!(await confirm(`ロール「${role.name}」を削除しますか？${members}`))) return;
        setBusy(true);
        try {
            await deleteRole(role.id);
            pushToast('ロールを削除しました');
            onDeleted();
        } catch (e) {
            setError(e instanceof Error ? e.message : '削除できませんでした');
            setBusy(false);
        }
    };

    return (
        <form
            className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
            onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void save();
            }}
        >
            <div className={css({ display: 'flex', alignItems: 'center', gap: '2', minH: '28px' })}>
                <RoleBadge role={{ name: draft.name.trim() || '名前', color: draft.color }} />
            </div>
            <label className={adminLabel}>
                名前
                <input
                    className={adminField()}
                    value={draft.name}
                    maxLength={ROLE_LIMITS.NAME_MAX * 2}
                    onChange={(e) => set('name', e.target.value)}
                />
            </label>
            <label className={adminLabel}>
                説明
                <textarea
                    className={adminField({ multiline: true })}
                    value={draft.description}
                    maxLength={ROLE_LIMITS.DESCRIPTION_MAX * 2}
                    onChange={(e) => set('description', e.target.value)}
                />
            </label>
            <div className={css({ display: 'flex', gap: '4', flexWrap: 'wrap' })}>
                <label className={adminLabel}>
                    色
                    <input
                        type="color"
                        className={colorInput}
                        value={draft.color}
                        onChange={(e) => set('color', e.target.value)}
                    />
                </label>
                <label className={adminLabel}>
                    表示順
                    <input
                        className={adminField({ compact: true })}
                        inputMode="numeric"
                        value={draft.displayOrder}
                        size={5}
                        onChange={(e) => set('displayOrder', e.target.value)}
                    />
                </label>
            </div>
            <p className={css({ fontSize: '12px', color: 'textMuted', mt: '-2' })}>
                表示順が大きいロールほど先に出ます。
            </p>
            <Switch
                title="プロフィールに出す"
                description="持っている人のプロフィールに、名前と色が出ます。出さないロールはコントロールパネルでだけ見えます。"
                on={draft.isPublic}
                disabled={busy}
                onChange={(next) => set('isPublic', next)}
            />
            <Switch
                title="管理者"
                description={`持っている人は、コントロールパネルでサーバーの設定をすべて変えられます。@${OFFICIAL_HANDLE} はロールに関係なく常に管理者です。`}
                on={draft.isAdministrator}
                disabled={busy}
                onChange={(next) => set('isAdministrator', next)}
            />
            {!checked.ok && draft !== NEW_ROLE_DRAFT && <p className={adminError}>{checked.error}</p>}
            {error && <p className={adminError}>{error}</p>}
            <div className={css({ display: 'flex', gap: '2', justifyContent: 'flex-end', flexWrap: 'wrap' })}>
                {role && (
                    <button
                        type="button"
                        className={adminButton({ tone: 'danger' })}
                        disabled={busy}
                        onClick={() => void remove()}
                    >
                        <HudIcon name="trash" size={16} />
                        削除
                    </button>
                )}
                <button type="submit" className={adminButton({ tone: 'primary' })} disabled={busy || !checked.ok}>
                    {role ? '保存' : '作成'}
                </button>
            </div>
        </form>
    );
}

const colorInput = css({
    w: '64px',
    h: '36px',
    p: '0.5',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'background',
    cursor: 'pointer',
});
