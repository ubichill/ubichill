/** 本番の DB・画像の処理につないだワールドの画像。規則は worldAssets.ts。 */
import { worldAssetRepository } from '@ubichill/db';
import { ENV_KEYS, SERVER_CONFIG, WORLD_ASSET_MAX_BYTES, WORLD_ASSET_MAX_PIXELS } from '@ubichill/shared';
import { createJobGate } from '../../utils/jobGate';
import { processImage } from '../profiles/images/processImage';
import { createSharpCodec } from '../profiles/images/sharpCodec';
import { createWorldAssets } from './worldAssets';

// プロフィール画像と別に絞る（大きい画像を続けて上げられても、アイコンの変更を待たせない）
const imageGate = createJobGate({ concurrency: 2, maxWaiting: 8 });
const codec = createSharpCodec({ maxPixels: WORLD_ASSET_MAX_PIXELS, timeoutSeconds: 20 });

export const worldAssetService = createWorldAssets({
    repository: worldAssetRepository,
    process: (input, target) =>
        imageGate.run(() =>
            processImage(input, target, codec, { maxBytes: WORLD_ASSET_MAX_BYTES, maxPixels: WORLD_ASSET_MAX_PIXELS }),
        ),
    publicBaseUrl: process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL,
});
