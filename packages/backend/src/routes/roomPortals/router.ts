import { ROOM_PORTAL_ADDRESS_MAX_LENGTH } from '@ubichill/shared';
import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { RoomPortalGrants } from '../../services/instances/roomPortalGrant';
import { logger } from '../../utils/logger';

export interface RoomPortalsRouterDeps {
    requireAuth: RequestHandler;
    limiter: RequestHandler;
    grants: RoomPortalGrants;
}

const GrantRequestSchema = z.object({ room: z.string().min(1).max(ROOM_PORTAL_ADDRESS_MAX_LENGTH) });

/**
 * 部屋へのポータル（`/api/v1/room-portals`）。
 * - `POST /grants`: `{ room }`（`portal:open` に送るのと同じ住所）へのポータルを置く許可 `{ grant }`。インスタンスが確かめる
 */
export function createRoomPortalsRouter(deps: RoomPortalsRouterDeps): Router {
    const router = Router();
    router.post('/grants', deps.requireAuth, deps.limiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const parsed = GrantRequestSchema.safeParse(req.body);
        if (!parsed.success) return void res.status(400).json({ error: '行き先の部屋が正しくありません' });
        try {
            const outcome = await deps.grants.issue(userId, parsed.data.room);
            if (!outcome.ok) return void res.status(outcome.status).json({ error: outcome.error });
            res.set('Cache-Control', 'no-store').json({ grant: outcome.grant });
        } catch (error) {
            logger.error('ポータルの許可を出せません:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
