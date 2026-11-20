import { perUserLimiter } from '../../lib/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { federation } from '../../services/federation';
import { profileService } from '../../services/profiles/profileService';
import { createProfilesRouter } from './router';

export const router = createProfilesRouter({
    requireAuth,
    writeLimiter: perUserLimiter(
        'profile-write',
        60 * 1000,
        30,
        'プロフィールの変更が多すぎます。少し待ってから試してください',
    ),
    uploadLimiter: perUserLimiter(
        'profile-images',
        10 * 60 * 1000,
        20,
        '画像のアップロードが多すぎます。少し待ってから試してください',
    ),
    profiles: profileService,
    onChanged: (userId) => federation?.profileChanged(userId),
});
