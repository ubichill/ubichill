import type { RoleFields } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    createRoleService,
    type RoleStore,
    type RoleUser,
    type RoleUserStore,
    type StoredRole,
    USER_LIST_LIMIT,
} from './roles';

const NOW = new Date('2026-11-10T00:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const SYSTEM = 'system-id';

interface Row {
    roleId: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date | null;
}

/** 偽の roleRepository（メモリ）。DB と同じく、期限の切れたアサインも assignmentsOf で返す。 */
function memoryRoles(users: Map<string, RoleUser>): RoleStore & { rows: Row[]; roles: Map<string, StoredRole> } {
    const roles = new Map<string, StoredRole>();
    const state = { rows: [] as Row[], seq: 0 };
    const active = (r: Row, now: Date) => r.expiresAt === null || r.expiresAt > now;
    const counted = (role: StoredRole, now: Date) => ({
        ...role,
        memberCount: state.rows.filter((r) => r.roleId === role.id && active(r, now)).length,
    });
    return {
        roles,
        get rows() {
            return state.rows;
        },
        list: async (now) => [...roles.values()].map((r) => counted(r, now)),
        findById: async (id, now) => {
            const role = roles.get(id);
            return role && counted(role, now);
        },
        create: async (fields: RoleFields, now) => {
            state.seq += 1;
            const role = { id: `r${state.seq}`, ...fields, createdAt: now, updatedAt: now };
            roles.set(role.id, role);
            return role;
        },
        update: async (id, fields, now) => {
            const role = roles.get(id);
            if (!role) return undefined;
            const next = { ...role, ...fields, updatedAt: now };
            roles.set(id, next);
            return next;
        },
        remove: async (id) => {
            state.rows = state.rows.filter((r) => r.roleId !== id);
            return roles.delete(id);
        },
        members: async (roleId, now) =>
            state.rows
                .filter((r) => r.roleId === roleId && active(r, now))
                .flatMap((r) => {
                    const u = users.get(r.userId);
                    return u
                        ? [
                              {
                                  user: { id: u.id, name: u.name, handle: u.handle, image: u.image },
                                  createdAt: r.createdAt,
                                  expiresAt: r.expiresAt,
                              },
                          ]
                        : [];
                }),
        assign: async (input, now) => {
            const existing = state.rows.find((r) => r.roleId === input.roleId && r.userId === input.userId);
            const row = { ...input, createdAt: existing?.createdAt ?? now };
            state.rows = [...state.rows.filter((r) => r !== existing), row];
            return { createdAt: row.createdAt, expiresAt: row.expiresAt };
        },
        unassign: async (roleId, userId) => {
            const before = state.rows.length;
            state.rows = state.rows.filter((r) => !(r.roleId === roleId && r.userId === userId));
            return state.rows.length < before;
        },
        assignmentsOf: async (userIds) =>
            state.rows.flatMap((r) => {
                const role = roles.get(r.roleId);
                return role && userIds.includes(r.userId) ? [{ userId: r.userId, role, expiresAt: r.expiresAt }] : [];
            }),
    };
}

const user = (id: string, handle = id): RoleUser => ({
    id,
    name: id.toUpperCase(),
    handle,
    image: null,
    createdAt: NOW,
});

function memoryUsers(list: RoleUser[]): RoleUserStore & { map: Map<string, RoleUser> } {
    const map = new Map(list.map((u) => [u.id, u]));
    return {
        map,
        findById: async (id) => map.get(id),
        findByHandle: async (handle) => [...map.values()].find((u) => u.handle === handle),
        search: async (query, options) =>
            [...map.values()]
                .filter((u) => !options.excludeIds.includes(u.id))
                .filter((u) => u.handle.startsWith(query.handlePrefix ?? '\u0000') || u.name.includes(query.nameKey))
                .slice(0, options.limit),
        listRecent: async (options) =>
            [...map.values()].filter((u) => !options.excludeIds.includes(u.id)).slice(0, options.limit),
    };
}

function setup() {
    const users = memoryUsers([user('root', 'ubichill'), user('alice'), user('bob'), user(SYSTEM, 'system')]);
    const roles = memoryRoles(users.map);
    const clock = { now: NOW };
    const service = createRoleService({
        roles,
        users,
        localDomain: () => 'ubichill.example',
        hiddenUserIds: [SYSTEM],
        now: () => clock.now,
    });
    return { service, roles, users, clock };
}

const input = (patch: Partial<RoleFields> = {}) => ({
    name: 'スタッフ',
    description: '',
    color: '#FF8800',
    isPublic: true,
    isAdministrator: false,
    displayOrder: 0,
    ...patch,
});

async function createRole(service: ReturnType<typeof setup>['service'], patch: Partial<RoleFields> = {}) {
    const created = await service.createRole(input(patch));
    if (!created.ok) throw new Error(created.error);
    return created.value;
}

describe('管理者の判定', () => {
    it('公式アカウントはロールが無くても管理者', async () => {
        const { service } = setup();
        expect(await service.isAdmin('root')).toBe(true);
    });

    it('管理者のロールを付けると管理者になり、外すと管理者でなくなる', async () => {
        const { service } = setup();
        const admin = await createRole(service, { isAdministrator: true });
        expect(await service.isAdmin('alice')).toBe(false);
        expect((await service.assign(admin.id, 'alice', { expiresAt: null })).ok).toBe(true);
        expect(await service.isAdmin('alice')).toBe(true);
        expect((await service.unassign(admin.id, 'alice')).ok).toBe(true);
        expect(await service.isAdmin('alice')).toBe(false);
    });

    it('期限の切れた管理者のロールでは管理者でない（掃除の前でも）', async () => {
        const { service, clock } = setup();
        const admin = await createRole(service, { isAdministrator: true });
        await service.assign(admin.id, 'alice', { expiresAt: at(60_000).toISOString() });
        expect(await service.isAdmin('alice')).toBe(true);
        clock.now = at(60_000);
        expect(await service.isAdmin('alice')).toBe(false);
    });

    it('管理者でないロールでは管理者でない。ロールの管理者を外すと、付いている人も管理者でなくなる', async () => {
        const { service } = setup();
        const staff = await createRole(service);
        await service.assign(staff.id, 'alice', { expiresAt: null });
        expect(await service.isAdmin('alice')).toBe(false);
        await service.updateRole(staff.id, input({ isAdministrator: true }));
        expect(await service.isAdmin('alice')).toBe(true);
        await service.updateRole(staff.id, input({ isAdministrator: false }));
        expect(await service.isAdmin('alice')).toBe(false);
    });

    it('いないユーザー・システムユーザーは管理者でない', async () => {
        const { service, roles } = setup();
        const admin = await createRole(service, { isAdministrator: true });
        // 直接 DB に入ってしまっていても、システムユーザーは管理者にしない
        roles.rows.push({ roleId: admin.id, userId: SYSTEM, createdAt: NOW, expiresAt: null });
        expect(await service.isAdmin(SYSTEM)).toBe(false);
        expect(await service.isAdmin('nobody')).toBe(false);
    });
});

describe('ロールの作成・変更・削除', () => {
    it('入力をそろえて保存し、表示順の大きい順に返す', async () => {
        const { service } = setup();
        await createRole(service, { name: '低い', displayOrder: 1 });
        await createRole(service, { name: '高い', displayOrder: 5, description: '  説明  ' });
        const roles = await service.listRoles();
        expect(roles.map((r) => r.name)).toEqual(['高い', '低い']);
        expect(roles[0]).toMatchObject({ color: '#ff8800', description: '説明', memberCount: 0 });
    });

    it('通らない値は 400 で、どの項目が悪いかを返し、何も保存しない', async () => {
        const { service } = setup();
        const bad = await service.createRole(input({ color: 'red' }));
        expect(bad).toMatchObject({ ok: false, status: 400 });
        expect(!bad.ok && bad.error).toContain('color');
        expect((await service.createRole({ ...input(), isModerator: true })).ok).toBe(false);
        expect((await service.createRole(null)).ok).toBe(false);
        expect(await service.listRoles()).toEqual([]);
    });

    it('無いロールの変更・削除・メンバーは 404', async () => {
        const { service } = setup();
        expect(await service.updateRole('missing', input())).toMatchObject({ ok: false, status: 404 });
        expect(await service.deleteRole('missing')).toMatchObject({ ok: false, status: 404 });
        expect(await service.members('missing')).toMatchObject({ ok: false, status: 404 });
    });

    it('変更してもメンバーの数を返す。消すとアサインも消える', async () => {
        const { service } = setup();
        const staff = await createRole(service);
        await service.assign(staff.id, 'alice', { expiresAt: null });
        const updated = await service.updateRole(staff.id, input({ name: '改名' }));
        expect(updated.ok && updated.value).toMatchObject({ name: '改名', memberCount: 1 });
        expect((await service.deleteRole(staff.id)).ok).toBe(true);
        expect(await service.publicRolesOf('alice')).toEqual([]);
    });
});

describe('アサイン', () => {
    it('過去・いまちょうどの期限、日付だけ・数値の期限は 400 で、何も付けない', async () => {
        const { service, roles } = setup();
        const staff = await createRole(service);
        for (const expiresAt of [NOW.toISOString(), at(-1).toISOString(), '2027-01-01', 1798761600000]) {
            expect(await service.assign(staff.id, 'alice', { expiresAt }), String(expiresAt)).toMatchObject({
                ok: false,
                status: 400,
            });
        }
        expect(await service.assign(staff.id, 'alice', {})).toMatchObject({ ok: false, status: 400 });
        expect(roles.rows).toEqual([]);
    });

    it('無いロール・いないユーザー・システムユーザーには付けない（404）', async () => {
        const { service, roles } = setup();
        const staff = await createRole(service);
        expect(await service.assign('missing', 'alice', { expiresAt: null })).toMatchObject({ status: 404 });
        expect(await service.assign(staff.id, 'nobody', { expiresAt: null })).toMatchObject({ status: 404 });
        expect(await service.assign(staff.id, SYSTEM, { expiresAt: null })).toMatchObject({ status: 404 });
        expect(roles.rows).toEqual([]);
    });

    it('付け直すと期限だけ変わり、付けた時刻はそのまま', async () => {
        const { service, clock } = setup();
        const staff = await createRole(service);
        await service.assign(staff.id, 'alice', { expiresAt: at(1000).toISOString() });
        clock.now = at(10);
        const again = await service.assign(staff.id, 'alice', { expiresAt: null });
        expect(again.ok && again.value).toMatchObject({ assignedAt: NOW.toISOString(), expiresAt: null });
        const members = await service.members(staff.id);
        expect(members.ok && members.value.map((m) => m.user.id)).toEqual(['alice']);
    });

    it('無いアサインを外すと 404', async () => {
        const { service } = setup();
        const staff = await createRole(service);
        expect(await service.unassign(staff.id, 'alice')).toMatchObject({ ok: false, status: 404 });
    });

    it('プロフィールには公開のロールだけを出す（非公開・期限切れは出さない）', async () => {
        const { service, clock } = setup();
        const visible = await createRole(service, { name: '見える', displayOrder: 1 });
        const hidden = await createRole(service, { name: '隠す', isPublic: false, displayOrder: 9 });
        const soon = await createRole(service, { name: 'すぐ切れる', displayOrder: 5 });
        for (const role of [visible, hidden]) await service.assign(role.id, 'alice', { expiresAt: null });
        await service.assign(soon.id, 'alice', { expiresAt: at(100).toISOString() });
        expect((await service.publicRolesOf('alice')).map((r) => r.name)).toEqual(['すぐ切れる', '見える']);
        clock.now = at(100);
        expect(await service.publicRolesOf('alice')).toEqual([{ id: visible.id, name: '見える', color: '#ff8800' }]);
    });
});

describe('ユーザーの一覧', () => {
    it('検索語が無ければ一覧。システムユーザーは出さず、公式アカウントはルートで管理者', async () => {
        const { service } = setup();
        const result = await service.searchUsers('');
        const users = result.ok ? result.value : [];
        expect(users.map((u) => u.id)).toEqual(['root', 'alice', 'bob']);
        expect(users.find((u) => u.id === 'root')).toMatchObject({ isRoot: true, isAdmin: true, roles: [] });
        expect(users.find((u) => u.id === 'alice')).toMatchObject({ isRoot: false, isAdmin: false });
    });

    it('非公開のロールも、期限と一緒に出す', async () => {
        const { service } = setup();
        const hidden = await createRole(service, { name: '隠す', isPublic: false, isAdministrator: true });
        await service.assign(hidden.id, 'alice', { expiresAt: at(5000).toISOString() });
        const result = await service.searchUsers('alice');
        expect(result.ok && result.value).toEqual([
            expect.objectContaining({
                id: 'alice',
                isAdmin: true,
                roles: [expect.objectContaining({ name: '隠す', isPublic: false, expiresAt: at(5000).toISOString() })],
            }),
        ]);
    });

    it('このサーバーのアカウントの指定は完全一致、ほかのサーバーの人は出さない、長すぎる検索語は 400', async () => {
        const { service } = setup();
        expect(await service.searchUsers('@bob@ubichill.example')).toMatchObject({
            ok: true,
            value: [expect.objectContaining({ id: 'bob' })],
        });
        expect(await service.searchUsers('@system@ubichill.example')).toEqual({ ok: true, value: [] });
        expect(await service.searchUsers('@bob@other.example')).toEqual({ ok: true, value: [] });
        expect(await service.searchUsers('x'.repeat(51))).toMatchObject({ ok: false, status: 400 });
    });

    it('一覧の上限を渡す', async () => {
        const { service, users } = setup();
        for (const n of Array.from({ length: USER_LIST_LIMIT + 5 }, (_, i) => i)) {
            users.map.set(`u${n}`, user(`u${n}`));
        }
        const result = await service.searchUsers('');
        expect(result.ok && result.value).toHaveLength(USER_LIST_LIMIT);
    });
});
