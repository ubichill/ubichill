import { type RequestHandler, type Response, Router } from 'express';
import type { FriendRequestRefusal, FriendshipService } from '../../services/social/friendships';

export interface FriendsRouterDeps {
    requireAuth: RequestHandler;
    friendships: FriendshipService;
}

const REQUEST_REFUSALS: Record<FriendRequestRefusal, { status: number; error: string }> = {
    blocking: { status: 409, error: 'ブロックを解除してから申請してください' },
    self: { status: 400, error: '自分には申請できません' },
    'not-found': { status: 404, error: 'User not found' },
    'remote-unavailable': { status: 404, error: 'ほかのサーバーの人が見つかりません' },
    gone: { status: 404, error: 'このアカウントは消えています' },
    unsupported: { status: 422, error: 'このサーバーはフレンドに対応していません' },
    'domain-limited': { status: 403, error: 'このサーバーの人とは、いまつながれません' },
};

const refuse = (res: Response, reason: FriendRequestRefusal) => {
    const { status, error } = REQUEST_REFUSALS[reason];
    return res.status(status).json({ error });
};

/**
 * フレンド（`/api/v1/social` の下）。相手はこのサーバーのユーザー ID か、ほかのサーバーの人の actor の URL。
 * - `GET /friends`: 自分のフレンド・自分への申請・自分の申請
 * - `POST /friends`: 申請する（相手から申請が来ていれば承認になる）
 * - `POST /friends/:userId/accept`: 自分への申請を承認する
 * - `DELETE /friends/:userId`: 解除・申請の取り消し・申請の拒否（どれも 2 人の関係を消す）
 */
export function createFriendsRouter(deps: FriendsRouterDeps): Router {
    const router = Router();

    router.get('/friends', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        return res.json(await deps.friendships.list(req.user.id));
    });

    router.post('/friends', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const targetId = typeof req.body?.userId === 'string' ? req.body.userId : '';
        const outcome = await deps.friendships.request(req.user.id, targetId);
        if (!outcome.ok) return refuse(res, outcome.reason);
        return res.json({ friendship: outcome.friendship });
    });

    router.post('/friends/:userId/accept', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const outcome = await deps.friendships.accept(req.user.id, String(req.params.userId));
        if (!outcome.ok) {
            return outcome.reason === 'remote-unavailable'
                ? refuse(res, 'remote-unavailable')
                : res.status(404).json({ error: '申請が見つかりません' });
        }
        return res.json({ friendship: 'friends' });
    });

    router.delete('/friends/:userId', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (!(await deps.friendships.remove(req.user.id, String(req.params.userId)))) {
            return res.status(404).json({ error: 'フレンド・申請が見つかりません' });
        }
        return res.status(204).send();
    });

    return router;
}
