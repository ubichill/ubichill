/**
 * ソーシャル（`/api/v1/social`）: 人を探す・フレンド・ブロック・フレンドの現在地。招待・リクエストインバイトは invitesRouter。
 * 業務の流れは services/social/、規則は shared の social/friends.ts・social/blocks.ts。ここは実体をつなぐだけ。
 */
import { Router } from 'express';
import { perUserLimiter } from '../../lib/rateLimit';
import { optionalAuth, requireAuth } from '../../middleware/auth';
import { blockService } from '../../services/social/blockService';
import { friendLocationsOf } from '../../services/social/friendLocations';
import { friendshipService } from '../../services/social/friendshipService';
import { people } from '../../services/social/relationService';
import { createBlocksRouter } from './blocks';
import { createFriendsRouter } from './friends';
import { createPeopleRouter } from './people';

export const router = Router();

router.use(createPeopleRouter({ requireAuth, optionalAuth, people }));
router.use(createFriendsRouter({ requireAuth, friendships: friendshipService }));
router.use(
    createBlocksRouter({
        requireAuth,
        limiter: perUserLimiter('social-blocks', 60 * 1000, 30, '操作が多すぎます。少し待ってから試してください'),
        blocks: blockService,
        people,
    }),
);

// フレンドの現在地（部屋ごと・フレンドの多い順）。決め方は services/social/friendLocations.ts
router.get('/locations', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json(await friendLocationsOf(req.user.id));
});
