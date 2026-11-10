import type { AdminUserView, Role, RoleMember } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { settingsNote } from '@/components/hud/tabs/settings/settingsStyles';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { type ExpiryPreset, expiresAtOf, expiryLabel } from '@/lib/admin/roleForm';
import { assignRole, fetchRoleMembers, searchAdminUsers, unassignRole } from '@/lib/adminApi';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { ExpirySelect, UserIdentity } from './AdminParts';
import { adminButton, adminError, adminField, adminIconButton, adminList, adminRow } from './adminStyles';

/** ロールのメンバー（期限の切れていない人）と、メンバーの追加。 */
export function RoleMembers({ target: role, onChanged }: { target: Role; onChanged: () => void }) {
    const confirm = useConfirm();
    const selfId = useSession().data?.user.id;
    const [members, setMembers] = useState<RoleMember[] | null>(null);
    const [query, setQuery] = useState('');
    const [candidates, setCandidates] = useState<AdminUserView[]>([]);
    const [expiry, setExpiry] = useState<ExpiryPreset>('none');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setMembers(await fetchRoleMembers(role.id));
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めませんでした');
        }
    }, [role.id]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const q = query.trim();
        if (!q) {
            setCandidates([]);
            return;
        }
        const ctrl = { cancelled: false };
        const timer = setTimeout(() => {
            searchAdminUsers(q)
                .then((users) => !ctrl.cancelled && setCandidates(users))
                .catch(
                    (e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '探せませんでした'),
                );
        }, 250);
        return () => {
            ctrl.cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);

    const run = async (task: () => Promise<void>, done: string) => {
        setBusy(true);
        setError(null);
        try {
            await task();
            pushToast(done);
            await load();
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : '変えられませんでした');
        } finally {
            setBusy(false);
        }
    };

    const add = async (user: AdminUserView) => {
        if (
            role.isAdministrator &&
            !(await confirm(`${user.name} を管理者にしますか？サーバーの設定をすべて変えられます。`))
        )
            return;
        await run(
            () => assignRole(role.id, user.id, expiresAtOf(expiry, new Date())).then(() => undefined),
            '追加しました',
        );
        setQuery('');
    };

    const remove = async (member: RoleMember) => {
        if (
            role.isAdministrator &&
            member.user.id === selfId &&
            !(await confirm('自分を外すと、コントロールパネルを使えなくなることがあります。外しますか？'))
        )
            return;
        await run(() => unassignRole(role.id, member.user.id), `${member.user.name} を外しました`);
    };

    const memberIds = new Set(members?.map((m) => m.user.id));
    const addable = candidates.filter((u) => !memberIds.has(u.id));

    return (
        <section className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <h3 className={css({ fontSize: '14px', fontWeight: '800', color: 'text' })}>
                メンバー{members ? ` ${members.length}` : ''}
            </h3>
            <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap', alignItems: 'center' })}>
                <input
                    className={adminField({ grow: true })}
                    value={query}
                    placeholder="名前か ID で探して追加"
                    aria-label="追加する人を探す"
                    onChange={(e) => setQuery(e.target.value)}
                />
                <ExpirySelect value={expiry} disabled={busy} onChange={setExpiry} />
            </div>
            {addable.length > 0 && (
                <ul className={adminList}>
                    {addable.map((user) => (
                        <li key={user.id} className={adminRow()}>
                            <UserIdentity user={user} />
                            <button
                                type="button"
                                className={adminButton({ tone: 'primary' })}
                                disabled={busy}
                                onClick={() => void add(user)}
                            >
                                <HudIcon name="plus" size={16} />
                                追加
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <p className={adminError}>{error}</p>}
            {members && members.length === 0 && <p className={settingsNote}>まだ誰にも付いていません。</p>}
            {members && members.length > 0 && (
                <ul className={adminList}>
                    {members.map((member) => (
                        <li key={member.user.id} className={adminRow()}>
                            <UserIdentity user={member.user} />
                            <span className={settingsNote}>{expiryLabel(member.expiresAt)}</span>
                            <button
                                type="button"
                                className={adminIconButton}
                                aria-label={`${member.user.name} を外す`}
                                title="外す"
                                disabled={busy}
                                onClick={() => void remove(member)}
                            >
                                <HudIcon name="close" size={16} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
