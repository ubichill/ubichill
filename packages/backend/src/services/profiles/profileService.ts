/** 本番の DB と画像の処理（sharp）につないだプロフィール。ルートとフェディバースの登録（アイコンの取り込み）で共用する。 */
import { profileImageRepository, userRepository } from '@ubichill/db';
import { ENV_KEYS, PROFILE_IMAGE_MAX_PIXELS, SERVER_CONFIG } from '@ubichill/shared';
import { createJobGate } from '../../utils/jobGate';
import { selfAccount } from '../authors/authorKeys';
import { roleService } from '../roles/roleService';
import { processProfileImage } from './images/processImage';
import { createSharpCodec } from './images/sharpCodec';
import { createProfileService } from './profiles';

// 画像の展開はメモリと libuv のスレッド（パスワードのハッシュと共用）を使うので、同時に作り直す数を絞る
const imageGate = createJobGate({ concurrency: 2, maxWaiting: 8 });
const codec = createSharpCodec({ maxPixels: PROFILE_IMAGE_MAX_PIXELS, timeoutSeconds: 15 });

export const profileService = createProfileService({
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
});
