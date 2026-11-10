import { type RequestHandler, Router } from 'express';
import type { People } from '../../services/social/people';

export interface PeopleRouterDeps {
    requireAuth: RequestHandler;
    optionalAuth: RequestHandler;
    people: Pick<People, 'search' | 'profileByHandle' | 'profileById'>;
}

/**
 * 人を探す・引く（`/api/v1/social` の下）。どれも自分との関係付き。
 * - `GET /users?q=`: ユーザー検索（ID の前方一致・表示名の部分一致・`@handle@domain`）
 * - `GET /users/by-handle/:handle`: ID（`/@handle`・`handle@domain`）で引く（ユーザーページ）
 * - `GET /users/:userId`: 内部 ID（ほかのサーバーの人は actor の URL）で引く
 */
export function createPeopleRouter(deps: PeopleRouterDeps): Router {
    const router = Router();

    router.get('/users', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const outcome = await deps.people.search(req.user.id, typeof req.query.q === 'string' ? req.query.q : '');
        if (!outcome.ok) return res.status(400).json({ error: '検索語が長すぎます' });
        return res.json(outcome.response);
    });

    router.get('/users/by-handle/:handle', deps.optionalAuth, async (req, res) => {
        const profile = await deps.people.profileByHandle(req.user?.id, String(req.params.handle));
        if (!profile) return res.status(404).json({ error: 'User not found' });
        return res.json(profile);
    });

    router.get('/users/:userId', deps.optionalAuth, async (req, res) => {
        const profile = await deps.people.profileById(req.user?.id, String(req.params.userId));
        if (!profile) return res.status(404).json({ error: 'User not found' });
        return res.json(profile);
    });

    return router;
}
