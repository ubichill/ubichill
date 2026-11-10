import type { Role } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { settingsNote } from '@/components/hud/tabs/settings/settingsStyles';
import { RoleBadge } from '@/components/profile/ProfileRoleBadges';
import { fetchRoles } from '@/lib/admin/adminApi';
import { css } from '@/styled-system/css';
import { adminButton, adminError, adminIconButton, adminList, adminRow, adminStack, adminTag } from './adminStyles';
import { RoleEditor } from './RoleEditor';
import { RoleMembers } from './RoleMembers';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'role'; roleId: string };

/** ロールの一覧と、作成・編集・メンバー。 */
export function RolesSection() {
    const [roles, setRoles] = useState<Role[] | null>(null);
    const [view, setView] = useState<View>({ kind: 'list' });
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setRoles(await fetchRoles());
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めませんでした');
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const back = () => setView({ kind: 'list' });
    const opened = view.kind === 'role' ? roles?.find((r) => r.id === view.roleId) : undefined;

    if (view.kind !== 'list') {
        return (
            <div className={adminStack}>
                <button type="button" className={adminIconButton} aria-label="ロールの一覧に戻る" onClick={back}>
                    <HudIcon name="back" size={18} />
                </button>
                {view.kind === 'new' && (
                    <RoleEditor
                        saved={null}
                        onSaved={(role) => {
                            setRoles((list) => [...(list ?? []), role]);
                            setView({ kind: 'role', roleId: role.id });
                            void load();
                        }}
                        onDeleted={back}
                    />
                )}
                {opened && (
                    <>
                        <RoleEditor
                            key={opened.updatedAt}
                            saved={opened}
                            onSaved={() => void load()}
                            onDeleted={() => {
                                back();
                                void load();
                            }}
                        />
                        <RoleMembers target={opened} onChanged={() => void load()} />
                    </>
                )}
            </div>
        );
    }

    return (
        <div className={adminStack}>
            <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                <p className={css({ flex: 1, fontSize: '12px', color: 'textMuted', lineHeight: '1.6' })}>
                    公開のロールは持っている人のプロフィールに出ます。管理者のロールを持つ人は、コントロールパネルを使えます。
                </p>
                <button
                    type="button"
                    className={adminButton({ tone: 'primary' })}
                    onClick={() => setView({ kind: 'new' })}
                >
                    <HudIcon name="plus" size={16} />
                    作成
                </button>
            </div>
            {error && <p className={adminError}>{error}</p>}
            {roles && roles.length === 0 && <p className={settingsNote}>まだロールがありません。</p>}
            {roles && roles.length > 0 && (
                <ul className={adminList}>
                    {roles.map((role) => (
                        <li key={role.id}>
                            <button
                                type="button"
                                className={adminRow({ interactive: true })}
                                onClick={() => setView({ kind: 'role', roleId: role.id })}
                            >
                                <span
                                    className={css({
                                        flex: 1,
                                        minW: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '2',
                                        flexWrap: 'wrap',
                                    })}
                                >
                                    <RoleBadge role={role} />
                                    {role.isAdministrator && (
                                        <span className={adminTag({ tone: 'strong' })}>管理者</span>
                                    )}
                                    {!role.isPublic && (
                                        <span className={adminTag()}>
                                            <HudIcon name="lock" size={11} />
                                            非公開
                                        </span>
                                    )}
                                </span>
                                <span className={memberCount}>
                                    <HudIcon name="users" size={14} />
                                    {role.memberCount}
                                    <span className={css({ srOnly: true })}>人</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

const memberCount = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    flexShrink: 0,
    fontSize: '12px',
    fontWeight: '700',
    color: 'textMuted',
    fontVariantNumeric: 'tabular-nums',
});
