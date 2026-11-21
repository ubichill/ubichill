import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RoleFields } from '@ubichill/shared';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBotProtection } from '../../services/auth/botProtection/botProtection';
import { createFeaturedServers } from '../../services/auth/fediverse/featuredServers';
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
            id === 'alice'
                ? {
                      id,
                      name: 'Alice',
                      handle: 'alice',
                      image: null,
                      createdAt: new Date(0),
                      email: 'alice@example.com',
                      emailVerified: true,
                  }
                : undefined,
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

/** 並べるサーバー（偽の保存先。misskey.example と mastodon.example だけログインの判定に通る） */
const featured = { hosts: [] as string[], changed: 0 };
const featuredServers = createFeaturedServers({
    repository: {
        list: async () => [...featured.hosts],
        add: async (host, max) => {
            if (featured.hosts.includes(host)) return 'exists';
            if (featured.hosts.length >= max) return 'full';
            featured.hosts.push(host);
            return 'added';
        },
        remove: async (host) => {
            const before = featured.hosts.length;
            featured.hosts = featured.hosts.filter((h) => h !== host);
            return featured.hosts.length < before;
        },
        reorder: async (hosts) => {
            if (hosts.length !== featured.hosts.length || !hosts.every((h) => featured.hosts.includes(h)))
                return 'mismatch';
            featured.hosts = [...hosts];
            return 'reordered';
        },
    },
    lookup: async (host) =>
        host === 'misskey.example' || host === 'mastodon.example'
            ? {
                  ok: true,
                  server: {
                      host,
                      software: host.startsWith('misskey') ? 'misskey' : 'mastodon',
                      name: null,
                      iconUrl: null,
                  },
              }
            : { ok: false, error: 'unsupported-server' },
    changed: () => {
        featured.changed++;
    },
    max: 2,
});

/** ボット対策（偽の保存先と検証 API。トークン `ok` だけ通る） */
const bot = { row: null as { provider: string; siteKey: string; secret: string; updatedAt: Date } | null };
const botProtection = createBotProtection({
    cached: async () => bot.row,
    repository: {
        get: async () => bot.row,
        put: async (input) => {
            bot.row = { ...input, updatedAt: new Date('2026-11-21T00:00:00Z') };
        },
        clear: async () => {
            bot.row = null;
        },
    },
    box: { seal: (plain) => `sealed:${new TextDecoder().decode(plain)}`, open: () => null },
    siteVerify: async (_provider, input) => ({
        success: input.token === 'ok',
        hostname: 'ubichill.example',
        action: 'bot-protection-settings',
        testing: false,
        errorCodes: [],
    }),
    hostnames: new Set(['ubichill.example']),
    allowTestingKeys: false,
    changed: () => {},
    warn: () => {},
});

const app = express();
app.use(express.json());
app.use(
    '/api/v1/admin',
    createAdminRouter({ requireAuth, requireAdmin, roles: service, featuredServers, botProtection }),
);
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
    ['GET', '/bot-protection'],
    ['PUT', '/bot-protection'],
    ['GET', '/fediverse-servers'],
    ['POST', '/fediverse-servers'],
    ['PUT', '/fediverse-servers/order'],
    ['DELETE', '/fediverse-servers/misskey.example'],
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

    describe('ログイン画面に並べるサーバー', () => {
        beforeEach(() => {
            featured.hosts = [];
            featured.changed = 0;
        });

        it('ログインの判定に通るサーバーだけ足せる。書き方は揃え、応答は変えた後の一覧', async () => {
            const added = await call('POST', '/fediverse-servers', { server: 'https://Misskey.Example/' });
            expect(added.status).toBe(201);
            expect(await added.json()).toEqual({ servers: ['misskey.example'] });
            const unsupported = await call('POST', '/fediverse-servers', { server: 'blog.example' });
            expect(unsupported.status).toBe(400);
            expect(((await unsupported.json()) as { error: string }).error).toBeTruthy();
            expect((await call('POST', '/fediverse-servers', { server: 'misskey.example' })).status).toBe(409);
            expect((await call('POST', '/fediverse-servers', { server: 'not a domain' })).status).toBe(400);
            expect(featured.hosts).toEqual(['misskey.example']);
            expect(featured.changed).toBe(1);
        });

        it('上限を超えては足せない', async () => {
            featured.hosts = ['a.example', 'b.example'];
            const res = await call('POST', '/fediverse-servers', { server: 'mastodon.example' });
            expect(res.status).toBe(400);
            expect(featured.hosts).toEqual(['a.example', 'b.example']);
        });

        it('並べ替えは今の一覧と同じ組だけ受け付ける（ほかの管理者が変えた後なら 409）', async () => {
            featured.hosts = ['misskey.example', 'mastodon.example'];
            const res = await call('PUT', '/fediverse-servers/order', {
                servers: ['mastodon.example', 'misskey.example'],
            });
            expect(await res.json()).toEqual({ servers: ['mastodon.example', 'misskey.example'] });
            for (const servers of [['mastodon.example'], ['mastodon.example', 'other.example'], 'x']) {
                expect((await call('PUT', '/fediverse-servers/order', { servers })).status).toBeGreaterThanOrEqual(400);
            }
            expect(featured.hosts).toEqual(['mastodon.example', 'misskey.example']);
        });

        it('外すと一覧から消え、並んでいなければ 404', async () => {
            featured.hosts = ['misskey.example'];
            expect(await (await call('DELETE', '/fediverse-servers/misskey.example')).json()).toEqual({ servers: [] });
            expect((await call('DELETE', '/fediverse-servers/misskey.example')).status).toBe(404);
        });
    });

    describe('ボット対策', () => {
        it('確かめて通った鍵だけ保存し、シークレットキーは返さない。キャッシュさせない', async () => {
            const body = { provider: 'turnstile', siteKey: 'site', secret: 'top-secret', token: 'bad' };
            const refused = await call('PUT', '/bot-protection', body);
            expect(refused.status).toBe(400);
            expect(bot.row).toBeNull();

            const saved = await call('PUT', '/bot-protection', { ...body, token: 'ok' });
            expect(saved.headers.get('cache-control')).toBe('no-store');
            const text = await saved.text();
            expect(text).not.toContain('top-secret');
            expect(JSON.parse(text)).toMatchObject({ config: { provider: 'turnstile', siteKey: 'site' } });
            expect(bot.row?.secret).toBe('sealed:top-secret');

            const current = await call('GET', '/bot-protection');
            expect(current.headers.get('cache-control')).toBe('no-store');
            expect(await current.text()).not.toContain('top-secret');

            expect(await (await call('PUT', '/bot-protection', { provider: null })).json()).toMatchObject({
                config: null,
            });
            expect(bot.row).toBeNull();
        });
    });
});
