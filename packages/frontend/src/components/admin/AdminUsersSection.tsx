import { type AdminUserView, type AssignedRole, OFFICIAL_HANDLE, type Role } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { settingsNote } from '@/components/hud/tabs/settings/settingsStyles';
import { RoleBadge } from '@/components/profile/ProfileRoleBadges';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { assignableRoles, type ExpiryPreset, expiresAtOf, expiryLabel } from '@/lib/admin/roleForm';
import { assignRole, fetchRoles, searchAdminUsers, unassignRole } from '@/lib/adminApi';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { AdminUser, ExpirySelect } from './AdminParts';
import {
    adminButton,
    adminError,
    adminField,
    adminIconButton,
    adminList,
    adminRow,
    adminStack,
    adminTag,
} from './adminStyles';

/** ユーザーを探し、付いているロールを見て変える（検索語が無ければ新しく登録した人から）。 */
export function AdminUsersSection() {
    const [query, setQuery] = useState('');
    const [users, setUsers] = useState<AdminUserView[] | null>(null);
    const [roles, setRoles] = useState<Role[]>([]);
    const [error, setError] = useState<string | null>(null);
    /** 最後に出した検索（遅れて返った古い結果で上書きしない） */
    const latest = useRef(0);

    useEffect(() => {
        fetchRoles()
            .then(setRoles)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ロールを読み込めませんでした'));
    }, []);

    const search = useCallback(async (q: string) => {
        latest.current += 1;
        const id = latest.current;
        try {
            const found = await searchAdminUsers(q.trim());
            if (latest.current !== id) return;
            setUsers(found);
            setError(null);
        } catch (e) {
            if (latest.current === id) setError(e instanceof Error ? e.message : '探せませんでした');
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => void search(query), 250);
        return () => clearTimeout(timer);
    }, [query, search]);

    return (
        <div className={adminStack}>
            <input
                className={adminField()}
                type="search"
                value={query}
                placeholder="名前か ID で探す"
                aria-label="ユーザーを探す"
                onChange={(e) => setQuery(e.target.value)}
            />
            {error && <p className={adminError}>{error}</p>}
            {users && users.length === 0 && <p className={settingsNote}>見つかりません。</p>}
            {users && users.length > 0 && (
                <ul className={adminList}>
                    {users.map((user) => (
                        <AdminUserRow key={user.id} user={user} roles={roles} onChanged={() => void search(query)} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function AdminUserRow({
    user,
    roles,
    onChanged,
}: {
    user: AdminUserView;
    roles: readonly Role[];
    onChanged: () => void;
}) {
    const confirm = useConfirm();
    const navigation = useHudNavigation();
    const selfId = useSession().data?.user.id;
    const [roleId, setRoleId] = useState('');
    const [expiry, setExpiry] = useState<ExpiryPreset>('none');
    const [busy, setBusy] = useState(false);
    const addable = assignableRoles(roles, user.roles);
    const picked = addable.find((r) => r.id === roleId);

    const run = async (task: () => Promise<unknown>, done: string) => {
        setBusy(true);
        try {
            await task();
            pushToast(done);
            setRoleId('');
            onChanged();
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '変えられませんでした', 'error');
        } finally {
            setBusy(false);
        }
    };

    const add = async () => {
        if (!picked) return;
        if (
            picked.isAdministrator &&
            !user.isAdmin &&
            !(await confirm(`${user.name} を管理者にしますか？サーバーの設定をすべて変えられます。`))
        )
            return;
        await run(
            () => assignRole(picked.id, user.id, expiresAtOf(expiry, new Date())),
            `「${picked.name}」を付けました`,
        );
    };

    const remove = async (role: AssignedRole) => {
        if (
            role.isAdministrator &&
            user.id === selfId &&
            !(await confirm('自分から外すと、コントロールパネルを使えなくなることがあります。外しますか？'))
        )
            return;
        await run(() => unassignRole(role.id, user.id), `「${role.name}」を外しました`);
    };

    return (
        <li className={adminRow({ wrap: true })}>
            <div className={css({ flex: '1 1 220px', minW: 0, display: 'flex', alignItems: 'center', gap: '3' })}>
                {navigation ? (
                    <button
                        type="button"
                        className={identityButton}
                        aria-label={`${user.name} のプロフィール`}
                        onClick={() => navigation.openUser(user.id)}
                    >
                        <AdminUser user={user} />
                    </button>
                ) : (
                    <AdminUser user={user} />
                )}
                {user.isRoot && (
                    <span
                        className={adminTag({ tone: 'strong' })}
                        title={`@${OFFICIAL_HANDLE} はロールに関係なく常に管理者です`}
                    >
                        <HudIcon name="shield" size={11} />
                        ルート
                    </span>
                )}
                {!user.isRoot && user.isAdmin && <span className={adminTag({ tone: 'strong' })}>管理者</span>}
            </div>
            {user.roles.length > 0 && (
                <ul className={css({ display: 'flex', flexWrap: 'wrap', gap: '1.5', w: 'full' })} aria-label="ロール">
                    {user.roles.map((role) => (
                        <li key={role.id} className={assigned}>
                            <RoleBadge role={role} />
                            {!role.isPublic && <HudIcon name="lock" size={11} />}
                            {role.expiresAt && <span className={settingsNote}>{expiryLabel(role.expiresAt)}</span>}
                            <button
                                type="button"
                                className={adminIconButton}
                                aria-label={`「${role.name}」を外す`}
                                disabled={busy}
                                onClick={() => void remove(role)}
                            >
                                <HudIcon name="close" size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {addable.length > 0 && (
                <form
                    className={css({ display: 'flex', gap: '2', flexWrap: 'wrap', alignItems: 'center', w: 'full' })}
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!busy) void add();
                    }}
                >
                    <select
                        className={adminField({ compact: true })}
                        value={roleId}
                        disabled={busy}
                        aria-label="付けるロール"
                        onChange={(e) => setRoleId(e.target.value)}
                    >
                        <option value="">ロールを付ける</option>
                        {addable.map((role) => (
                            <option key={role.id} value={role.id}>
                                {role.name}
                            </option>
                        ))}
                    </select>
                    {picked && (
                        <>
                            <ExpirySelect value={expiry} disabled={busy} onChange={setExpiry} />
                            <button type="submit" className={adminButton({ tone: 'primary' })} disabled={busy}>
                                付ける
                            </button>
                        </>
                    )}
                </form>
            )}
        </li>
    );
}

const identityButton = css({
    flex: 1,
    minW: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    p: 0,
    border: 'none',
    bg: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    _hover: { opacity: 0.8 },
});

const assigned = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    color: 'textMuted',
    minW: 0,
    maxW: 'full',
});
