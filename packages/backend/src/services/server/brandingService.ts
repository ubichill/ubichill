/** 本番の DB・画像の処理につないだサーバーのブランディング。規則は branding.ts。 */
import { serverBrandingRepository } from '@ubichill/db';
import { ENV_KEYS, PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_MAX_PIXELS, SERVER_CONFIG } from '@ubichill/shared';
import { createJobGate } from '../../utils/jobGate';
import { createSharpCodec } from '../profiles/images/sharpCodec';
import { createBranding } from './branding';
import { processServerImage } from './brandingImages';

// 管理者だけが使い、めったに変えないので 1 枚ずつにする（利用者の画像の処理を待たせない）
const imageGate = createJobGate({ concurrency: 1, maxWaiting: 2 });
const codec = createSharpCodec({ maxPixels: PROFILE_IMAGE_MAX_PIXELS, timeoutSeconds: 15 });

export const brandingService = createBranding({
    repository: serverBrandingRepository,
    processImage: (kind, input) =>
        imageGate.run(() =>
            processServerImage(kind, input, codec, {
                maxBytes: PROFILE_IMAGE_MAX_BYTES,
                maxPixels: PROFILE_IMAGE_MAX_PIXELS,
            }),
        ),
    publicBaseUrl: process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL,
});
