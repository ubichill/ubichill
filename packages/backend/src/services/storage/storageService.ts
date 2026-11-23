/** 本番の DB につないだストレージ（設定の「ストレージ」と、管理者の 1 人あたりの容量）。規則は storage.ts・storageQuota.ts。 */
import { storageSettingsRepository, userSettingsRepository, worldAssetRepository } from '@ubichill/db';
import { ENV_KEYS, SERVER_CONFIG } from '@ubichill/shared';
import { createStorage } from './storage';
import { createStorageQuota } from './storageQuota';

export const storageQuotaService = createStorageQuota({
    repository: storageSettingsRepository,
    totalBytes: () => worldAssetRepository.totalBytes(),
});

export const storageService = createStorage({
    worldAssets: worldAssetRepository,
    settings: userSettingsRepository,
    quotaBytes: () => storageQuotaService.worldAssetQuotaBytes(),
    publicBaseUrl: process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL,
});
