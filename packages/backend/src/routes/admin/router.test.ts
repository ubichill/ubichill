import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RoleFields } from '@ubichill/shared';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoleService, type RoleStore, type StoredRole } from '../../services/roles/roles';
import { createAdminRouter } from './router';

/** 偽の roleRepository（このテストで使う分だけ）。 */
function memoryRoles(): RoleStore & { clear: () => void } {
    const roles = new Map<string, StoredRole>();
    const members = new Map<string, Set<string>>();
    const counted = (role: StoredRole) => ({ ...role, memberCount: members.get(role.id)?.size ?? 0 });
    return {
        clear: () => {
            roles.clear();
            members.clear();
        },
        list: async () => [...roles.values()].map(counted),
        findById: async (id) => {
            const role = roles.get(id);
            return role && counted(role);
        },
        create: async (fields: RoleFields, now) => {
            const role = { id: `r${roles.size + 1}`, ...fields, createdAt: now, updatedAt: now };
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
        remove: async (id) => roles.delete(id),
        members: async (roleId, now) =>
            [...(members.get(roleId) ?? [])].map((id) => ({
                user: { id, name: id, handle: id, image: null },
                createdAt: now,
                expiresAt: null,
            })),
        assign: async (input, now) => {
            members.set(input.roleId, new Set([...(members.get(input.roleId) ?? []), input.userId]));
            return { createdAt: now, expiresAt: input.expiresAt };
        },
        unassign: async (roleId, userId) => members.get(roleId)?.delete(userId) ?? false,
        assignmentsOf: async () => [],
    };
}

const roles = memoryRoles();
const service = createRoleService({
    roles,
    users: {
        findById: async (id) =>
            id === 'alice' ? { id, name: 'Alice', handle: 'alice', image: null, createdAt: new Date(0) } : undefined,
        findByHandle: async () => undefined,
        search: async () => [],
        listRecent: async () => [],
    },
    localDomain: () => 'ubichill.example',
    hiddenUserIds: [],
});

/** `x-user` でログイン、`x-admin: 1` で管理者の扱い。 */
const requireAuth: RequestHandler = (req, res, next) => {
    const id = req.get('x-user');
    if (!id) return void res.status(401).json({ error: 'Unauthorized' });
    req.user = { id, email: `${id}@example.com`, name: id, emailVerified: true };
    next();
};
const requireAdmin: RequestHandler = (req, res, next) => {
    if (req.get('x-admin') !== '1') return void res.status(403).json({ error: 'Forbidden' });
    next();
};

const app = express();
app.use(express.json());
app.use('/api/v1/admin', createAdminRouter({ requireAuth, requireAdmin, roles: service }));
const server = createServer(app);
const url = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin${path}`;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = admin) =>
    fetch(url(path), {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
const admin = { 'x-user': 'root', 'x-admin': '1' };
const roleBody = {
    name: 'スタッフ',
    description: '',
    color: '#00aa88',
    isPublic: true,
    isAdministrator: false,
    displayOrder: 0,
};

const ENDPOINTS: ReadonlyArray<[string, string]> = [
    ['GET', '/roles'],
    ['POST', '/roles'],
    ['PUT', '/roles/r1'],
    ['DELETE', '/roles/r1'],
    ['GET', '/roles/r1/members'],
    ['PUT', '/roles/r1/members/alice'],
    ['DELETE', '/roles/r1/members/alice'],
    ['GET', '/users'],
];

describe('コントロールパネルの API', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    beforeEach(() => roles.clear());

    it('どの操作も、ログインしていなければ 401、管理者でなければ 403（何も変えない）', async () => {
        for (const [method, path] of ENDPOINTS) {
            const body = method === 'GET' || method === 'DELETE' ? undefined : roleBody;
            expect((await call(method, path, body, {})).status, `${method} ${path}`).toBe(401);
            expect((await call(method, path, body, { 'x-user': 'alice' })).status, `${method} ${path}`).toBe(403);
        }
        expect(await service.listRoles()).toEqual([]);
    });

    it('作ると 201、変えると 200、消すと 204。どれも cache させない', async () => {
        const created = await call('POST', '/roles', roleBody);
        expect(created.status).toBe(201);
        expect(created.headers.get('cache-control')).toBe('no-store');
        const role = (await created.json()) as { id: string; memberCount: number };
        expect(role.memberCount).toBe(0);

        const updated = await call('PUT', `/roles/${role.id}`, { ...roleBody, name: '改名' });
        expect(updated.status).toBe(200);
        expect(await updated.json()).toMatchObject({ name: '改名' });

        const removed = await call('DELETE', `/roles/${role.id}`);
        expect(removed.status).toBe(204);
        expect(await removed.text()).toBe('');
        expect((await call('DELETE', `/roles/${role.id}`)).status).toBe(404);
    });

    it('通らない値は 400 で理由を返す', async () => {
        const res = await call('POST', '/roles', { ...roleBody, color: 'url(javascript:alert(1))' });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain('color');
    });

    it('アサインとメンバーの一覧', async () => {
        const role = (await (await call('POST', '/roles', roleBody)).json()) as { id: string };
        expect(
            (await call('PUT', `/roles/${role.id}/members/alice`, { expiresAt: '2000-01-01T00:00:00Z' })).status,
        ).toBe(400);
        expect((await call('PUT', `/roles/${role.id}/members/nobody`, { expiresAt: null })).status).toBe(404);
        const assigned = await call('PUT', `/roles/${role.id}/members/alice`, { expiresAt: null });
        expect(assigned.status).toBe(200);
        expect(await assigned.json()).toMatchObject({ user: { id: 'alice' }, expiresAt: null });

        const members = await call('GET', `/roles/${role.id}/members`);
        expect(await members.json()).toEqual({ members: [expect.objectContaining({ user: expect.anything() })] });
        expect((await call('DELETE', `/roles/${role.id}/members/alice`)).status).toBe(204);
        expect((await call('DELETE', `/roles/${role.id}/members/alice`)).status).toBe(404);
    });

    it('ユーザーの一覧は users で包んで返す', async () => {
        const res = await call('GET', '/users?q=alice');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ users: [] });
    });
});
