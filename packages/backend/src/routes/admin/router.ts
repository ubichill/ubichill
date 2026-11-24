import { isServerImageKind, PROFILE_IMAGE_MAX_BYTES } from '@ubichill/shared';
import { type RequestHandler, type Response, Router } from 'express';
import type { BotProtection } from '../../services/auth/botProtection/botProtection';
import type { FeaturedServers } from '../../services/auth/fediverse/featuredServers';
import type { RoleService } from '../../services/roles/roles';
import type { BrandingService } from '../../services/server/branding';
import type { ServerInfoService } from '../../services/server/serverInfo';
import type { StorageQuota } from '../../services/storage/storageQuota';
import { imageBodyErrors, readImageBody } from '../imageHttp';

export interface AdminRouterDeps {
    requireAuth: RequestHandler;
    requireAdmin: RequestHandler;
    roles: RoleService;
    featuredServers: FeaturedServers;
    botProtection: Pick<BotProtection, 'settings' | 'update'>;
    serverInfo: Pick<ServerInfoService, 'settings' | 'update'>;
    branding: Pick<BrandingService, 'update' | 'replaceImage' | 'removeImage'>;
    storage: Pick<StorageQuota, 'settings' | 'update'>;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };

/** 失敗はその状態で返す。本文が null なら 204。 */
const send = <T>(res: Response, outcome: Outcome<T>, view: (value: T) => object | null, status = 200): void => {
    res.set('Cache-Control', 'no-store');
    if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) });
        return;
    }
    const body = view(outcome.value);
    if (body === null) res.status(204).send();
    else res.status(status).json(body);
};

const same = <T extends object | null>(value: T): T => value;

/**
 * コントロールパネル（`/api/v1/admin`。管理者だけ）。
 * - `GET /roles`・`POST /roles`・`PUT /roles/:roleId`・`DELETE /roles/:roleId`: ロール
 * - `GET /roles/:roleId/members`・`PUT /roles/:roleId/members/:userId`（本文 `{ expiresAt }`）・
 *   `DELETE /roles/:roleId/members/:userId`: アサイン
 * - `GET /users?q=`: ユーザーとロール（検索語が無ければ新しく登録した順）
 * - `GET /fediverse-servers`・`POST /fediverse-servers`（本文 `{ server }`）・`PUT /fediverse-servers/order`
 *   （本文 `{ servers }`）・`DELETE /fediverse-servers/:host`: ログイン画面に並べるサーバー（応答は変えた後の一覧）
 * - `GET /bot-protection`・`PUT /bot-protection`（本文は shared の BotProtectionUpdate）: ボット対策（応答は変えた後の設定）
 * - `GET /server-info`・`PUT /server-info`（本文は shared の ServerInfoInput）: サーバーの情報（応答は変えた後の設定）
 * - `PUT /branding`（本文は shared の ServerBrandingUpdateInput）・`PUT /branding/images/:kind`（本文は image/* のバイト列）・
 *   `DELETE /branding/images/:kind`: ブランディング（応答は変えた後のブランディング。読むのは `GET /api/v1/server`）
 * - `GET /storage`・`PUT /storage`（本文は shared の StorageQuotaInput）: 1 人あたりの容量（応答は変えた後の設定）
 * 連合の設定は `/api/v1/federation`、お知らせは `/api/v1/notifications/announcements`。
 */
export function createAdminRouter(deps: AdminRouterDeps): Router {
    const router = Router();
    router.use(deps.requireAuth, deps.requireAdmin);

    router.get('/roles', async (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ roles: await deps.roles.listRoles() });
    });

    router.post('/roles', async (req, res) => {
        send(res, await deps.roles.createRole(req.body), same, 201);
    });

    router.put('/roles/:roleId', async (req, res) => {
        send(res, await deps.roles.updateRole(req.params.roleId, req.body), same);
    });

    router.delete('/roles/:roleId', async (req, res) => {
        send(res, await deps.roles.deleteRole(req.params.roleId), same);
    });

    router.get('/roles/:roleId/members', async (req, res) => {
        send(res, await deps.roles.members(req.params.roleId), (members) => ({ members }));
    });

    router.put('/roles/:roleId/members/:userId', async (req, res) => {
        send(res, await deps.roles.assign(req.params.roleId, req.params.userId, req.body), same);
    });

    router.delete('/roles/:roleId/members/:userId', async (req, res) => {
        send(res, await deps.roles.unassign(req.params.roleId, req.params.userId), same);
    });

    router.get('/users', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q : '';
        send(res, await deps.roles.searchUsers(q), (users) => ({ users }));
    });

    router.get('/fediverse-servers', async (_req, res) => {
        send(res, await deps.featuredServers.list(), same);
    });

    router.post('/fediverse-servers', async (req, res) => {
        send(res, await deps.featuredServers.add(req.body?.server), same, 201);
    });

    router.put('/fediverse-servers/order', async (req, res) => {
        send(res, await deps.featuredServers.reorder(req.body), same);
    });

    router.delete('/fediverse-servers/:host', async (req, res) => {
        send(res, await deps.featuredServers.remove(req.params.host), same);
    });

    router.get('/bot-protection', async (_req, res) => {
        res.set('Cache-Control', 'no-store').json(await deps.botProtection.settings());
    });

    router.put('/bot-protection', async (req, res) => {
        send(res, await deps.botProtection.update(req.body), same);
    });

    router.get('/server-info', async (_req, res) => {
        res.set('Cache-Control', 'no-store').json(await deps.serverInfo.settings());
    });

    router.put('/server-info', async (req, res) => {
        send(res, await deps.serverInfo.update(req.body), same);
    });

    router.put('/branding', async (req, res) => {
        send(res, await deps.branding.update(req.body), same);
    });

    router.put(
        '/branding/images/:kind',
        (req, res, next) => {
            if (!isServerImageKind(req.params.kind)) {
                res.status(404).json({ error: '画像の種類は icon か banner です', code: 'not-found' });
                return;
            }
            if (!req.is('image/*')) {
                res.status(415).json({ error: '画像（image/*）を送ってください', code: 'unsupported' });
                return;
            }
            next();
        },
        readImageBody(PROFILE_IMAGE_MAX_BYTES),
        async (req, res) => {
            const kind = req.params.kind;
            if (!isServerImageKind(kind)) {
                res.status(404).json({ error: '画像の種類は icon か banner です', code: 'not-found' });
                return;
            }
            const body: unknown = req.body;
            const input = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
            send(res, await deps.branding.replaceImage(kind, input), same);
        },
    );

    router.delete('/branding/images/:kind', async (req, res) => {
        const kind = req.params.kind;
        if (!isServerImageKind(kind)) {
            res.status(404).json({ error: '画像の種類は icon か banner です', code: 'not-found' });
            return;
        }
        send(res, await deps.branding.removeImage(kind), same);
    });

    router.get('/storage', async (_req, res) => {
        res.set('Cache-Control', 'no-store').json(await deps.storage.settings());
    });

    router.put('/storage', async (req, res) => {
        send(res, await deps.storage.update(req.body), same);
    });

    router.use(imageBodyErrors(PROFILE_IMAGE_MAX_BYTES));
    return router;
}
