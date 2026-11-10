import { profileImageRepository, userRepository } from '@ubichill/db';
import { ENV_KEYS, PROFILE_IMAGE_MAX_PIXELS, SERVER_CONFIG } from '@ubichill/shared';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAuth } from '../middleware/auth';
import { selfAccount } from '../services/authors/authorKeys';
import { federation } from '../services/federation';
import { processProfileImage } from '../services/profiles/images/processImage';
import { createSharpCodec } from '../services/profiles/images/sharpCodec';
import { createProfileService } from '../services/profiles/profiles';
import { roleService } from '../services/roles/roleService';
import { createJobGate } from '../utils/jobGate';
import { logger } from '../utils/logger';
import { createProfilesRouter } from './profiles';

// 画像の展開はメモリと libuv のスレッド（パスワードのハッシュと共用）を使うので、同時に作り直す数を絞る
const imageGate = createJobGate({ concurrency: 2, maxWaiting: 8 });
const codec = createSharpCodec({ maxPixels: PROFILE_IMAGE_MAX_PIXELS, timeoutSeconds: 15 });

const perUser = (name: string, windowMs: number, limit: number, error: string) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anonymous',
        message: { error },
        ...sharedRateLimit(name, redis, logger),
    });

export const router = createProfilesRouter({
    requireAuth,
    writeLimiter: perUser(
        'profile-write',
        60 * 1000,
        30,
        'プロフィールの変更が多すぎます。少し待ってから試してください',
    ),
    uploadLimiter: perUser(
        'profile-images',
        10 * 60 * 1000,
        20,
        '画像のアップロードが多すぎます。少し待ってから試してください',
    ),
    profiles: createProfileService({
        users: {
            findById: (id) => userRepository.findProfileById(id),
            setProfile: (id, profile) => userRepository.setProfile(id, profile),
            setProfileImageUrl: (id, kind, url) => userRepository.setProfileImageUrl(id, kind, url),
        },
        images: profileImageRepository,
        processImage: (input, kind) => imageGate.run(() => processProfileImage(input, kind, codec)),
        publicBaseUrl: process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL,
        authorOf: selfAccount,
        publicRolesOf: (userId) => roleService.publicRolesOf(userId),
    }),
    onChanged: (userId) => federation?.profileChanged(userId),
});
