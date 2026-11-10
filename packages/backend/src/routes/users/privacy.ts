/** プライバシーの設定（`/api/v1/users/me` の下）。お気に入りの公開範囲は favorites.ts、フェディバースは /api/v1/fediverse。 */
import { userSettingsRepository } from '@ubichill/db';
import { PRESENCE_VISIBILITIES, PresenceVisibilitySchema, type PrivacySettings } from '@ubichill/shared';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';

export const router = Router();

router.get('/me/privacy', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const [favoritesVisibility, presenceVisibility] = await Promise.all([
        userSettingsRepository.getFavoritesVisibility(req.user.id),
        userSettingsRepository.getPresenceVisibility(req.user.id),
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json({ favoritesVisibility, presenceVisibility } satisfies PrivacySettings);
});

// オンライン状態をフレンドにどこまで見せるか（location / online / hidden）。
router.put('/me/presence', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = PresenceVisibilitySchema.safeParse(req.body?.visibility);
    if (!parsed.success) {
        return res.status(400).json({ error: `visibility は ${PRESENCE_VISIBILITIES.join(' / ')} のいずれかです` });
    }
    await userSettingsRepository.setPresenceVisibility(req.user.id, parsed.data);
    return res.json({ visibility: parsed.data });
});
