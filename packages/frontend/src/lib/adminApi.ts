import type { AdminUserView, Role, RoleInput, RoleMember } from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

const BASE = `${API_BASE}/api/v1/admin`;

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return res;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export async function fetchRoles(): Promise<Role[]> {
    return ((await (await request('/roles')).json()) as { roles: Role[] }).roles;
}

export async function createRole(input: RoleInput): Promise<Role> {
    return (await (await request('/roles', { method: 'POST', ...json(input) })).json()) as Role;
}

export async function updateRole(roleId: string, input: RoleInput): Promise<Role> {
    return (await (
        await request(`/roles/${encodeURIComponent(roleId)}`, { method: 'PUT', ...json(input) })
    ).json()) as Role;
}

export async function deleteRole(roleId: string): Promise<void> {
    await request(`/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
}

export async function fetchRoleMembers(roleId: string): Promise<RoleMember[]> {
    return ((await (await request(`/roles/${encodeURIComponent(roleId)}/members`)).json()) as { members: RoleMember[] })
        .members;
}

/** アサインする（すでにあれば期限を変える）。期限は ISO 8601（無期限は null）。 */
export async function assignRole(roleId: string, userId: string, expiresAt: string | null): Promise<RoleMember> {
    const path = `/roles/${encodeURIComponent(roleId)}/members/${encodeURIComponent(userId)}`;
    return (await (await request(path, { method: 'PUT', ...json({ expiresAt }) })).json()) as RoleMember;
}

export async function unassignRole(roleId: string, userId: string): Promise<void> {
    await request(`/roles/${encodeURIComponent(roleId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

/** ユーザーとロール（検索語が空なら新しく登録した順）。 */
export async function searchAdminUsers(q: string): Promise<AdminUserView[]> {
    return ((await (await request(`/users?q=${encodeURIComponent(q)}`)).json()) as { users: AdminUserView[] }).users;
}
