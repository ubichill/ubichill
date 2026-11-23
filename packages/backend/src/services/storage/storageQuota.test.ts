import { WORLD_ASSET_QUOTA_BYTES } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createStorageQuota } from './storageQuota';

const MB = 1024 * 1024;

function setup() {
    const row: { value: { worldAssetQuotaBytes: number; updatedAt: Date } | null } = { value: null };
    const quota = createStorageQuota({
        repository: {
            get: async () => row.value,
            put: async (input) => {
                row.value = { ...input, updatedAt: new Date('2026-11-22T00:00:00Z') };
            },
        },
        totalBytes: async () => 42 * MB,
    });
    return { quota, row };
}

describe('createStorageQuota', () => {
    it('保存していなければ既定の 200 MB', async () => {
        const { quota } = setup();
        expect(await quota.worldAssetQuotaBytes()).toBe(200 * MB);
        expect(await quota.settings()).toEqual({
            worldAssetQuotaBytes: 200 * MB,
            totalBytes: 42 * MB,
            updatedAt: null,
        });
    });

    it('10 MB〜10 GB の整数だけを保存し、保存した値を次から使う', async () => {
        const { quota, row } = setup();
        for (const bad of [
            { worldAssetQuotaBytes: WORLD_ASSET_QUOTA_BYTES.min - 1 },
            { worldAssetQuotaBytes: WORLD_ASSET_QUOTA_BYTES.max + 1 },
            { worldAssetQuotaBytes: '1073741824' },
            { worldAssetQuotaBytes: 1.5 },
            { worldAssetQuotaBytes: -1 },
            {},
            null,
        ]) {
            expect(await quota.update(bad)).toMatchObject({ ok: false, status: 400 });
        }
        expect(row.value).toBeNull();

        expect(await quota.update({ worldAssetQuotaBytes: 1024 * MB })).toEqual({
            ok: true,
            value: { worldAssetQuotaBytes: 1024 * MB, totalBytes: 42 * MB, updatedAt: '2026-11-22T00:00:00.000Z' },
        });
        expect(await quota.worldAssetQuotaBytes()).toBe(1024 * MB);
    });
});
