import { type RequestHandler, type Response, Router } from 'express';
import type { RoleOutcome, RoleService } from '../../services/roles/roles';

export interface AdminRouterDeps {
    requireAuth: RequestHandler;
    requireAdmin: RequestHandler;
    roles: RoleService;
}

/** 失敗はその状態で返す。本文が null なら 204。 */
const send = <T>(res: Response, outcome: RoleOutcome<T>, view: (value: T) => object | null, status = 200): void => {
    res.set('Cache-Control', 'no-store');
    if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
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

    return router;
}
