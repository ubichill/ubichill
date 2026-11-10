/**
 * ほかの人に見せるユーザーの情報（`/api/v1/users/:userId` の下）: 公開プロフィール・お気に入り・作ったワールド・mod。
 * `/:userId` は `/me` にも当たるので、index.ts で自分の分のあとに置く。
 */
import { userRepository } from '@ubichill/db';
import type { UserProfile } from '@ubichill/shared';
import { Router } from 'express';
import { optionalAuth } from '../../middleware/auth';
import { publicProfileOf } from '../../services/users/publicProfile';
import { favoriteService } from '../../services/worlds/favoriteService';
import { publishedWorks } from '../../services/worlds/publishedWorkService';

export const router = Router();

router.get('/:userId', async (req, res) => {
    const user = await userRepository.findProfileById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json((await publicProfileOf(user)) satisfies UserProfile);
});

// 公開範囲（private / friends / public）に従い、見てよい人にだけ返す。public ならログイン不要。
router.get('/:userId/favorites', optionalAuth, async (req, res) => {
    const outcome = await favoriteService.visibleTo(req.user?.id, String(req.params.userId));
    if (!outcome.ok) {
        // 公開範囲を絞っているユーザーのお気に入りは、中身も件数も返さない
        return outcome.reason === 'not-found'
            ? res.status(404).json({ error: 'User not found' })
            : res.status(403).json({ error: 'このユーザーのお気に入りは公開されていません', code: 'favorites-hidden' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.json({ worlds: outcome.worlds, visibility: outcome.visibility });
});

// 作ったワールド（公開メタデータのみ。署名して公開したもの・リポジトリ・外部）
router.get('/:userId/worlds', async (req, res) => {
    const owner = await userRepository.findById(req.params.userId);
    return res.json({ worlds: await publishedWorks.worldsOf(req.params.userId, owner) });
});

// 公開している mod（外部に置いたもののうち、いま本人の署名付きで配られていると確かめられたもの）
router.get('/:userId/mods', async (req, res) => {
    const owner = await userRepository.findById(req.params.userId);
    return res.json({ mods: owner ? await publishedWorks.modsOf(owner) : [] });
});
