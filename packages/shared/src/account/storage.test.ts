import { describe, expect, it } from 'vitest';
import { WORLD_ASSET_QUOTA_BYTES, WORLD_ASSET_QUOTA_PRESETS } from '../world/assets';
import { formatBytes, StorageQuotaInputSchema, StorageSettingsSchema } from './storage';

const MB = 1024 * 1024;

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [-5, '0 B'],
        [1023, '1023 B'],
        [1024, '1 KB'],
        [1536, '1.5 KB'],
        [45.26 * MB, '45.3 MB'],
        [200 * MB, '200 MB'],
        [1024 * MB, '1 GB'],
        // 丸めると 1024 MB になる値は、上の単位で出す
        [1023.9 * MB, '1 GB'],
        [1.25 * 1024 * MB, '1.3 GB'],
        [10 * 1024 * MB, '10 GB'],
        [3 * 1024 ** 5, '3072 TB'],
    ])('%d バイトは %s', (bytes, shown) => {
        expect(formatBytes(bytes)).toBe(shown);
    });
});

describe('StorageQuotaInputSchema', () => {
    const parse = (worldAssetQuotaBytes: unknown) => StorageQuotaInputSchema.safeParse({ worldAssetQuotaBytes });
    const message = (worldAssetQuotaBytes: unknown) => parse(worldAssetQuotaBytes).error?.issues[0]?.message;

    it('10 MB から 10 GB まで（両端を含む）', () => {
        expect(parse(WORLD_ASSET_QUOTA_BYTES.min).success).toBe(true);
        expect(parse(WORLD_ASSET_QUOTA_BYTES.max).success).toBe(true);
        expect(message(WORLD_ASSET_QUOTA_BYTES.min - 1)).toBe('1 人あたりの容量は 10 MB 以上にしてください');
        expect(message(WORLD_ASSET_QUOTA_BYTES.max + 1)).toBe('1 人あたりの容量は 10 GB 以下にしてください');
    });

    it('数でないもの・小数・余計な項目は通さない', () => {
        expect(message('1073741824')).toBe('1 人あたりの容量を数で指定してください');
        expect(message(200 * MB + 0.5)).toBe('1 人あたりの容量はバイトの整数で指定してください');
        expect(message(Number.NaN)).toBeDefined();
        expect(message(Number.POSITIVE_INFINITY)).toBeDefined();
        expect(StorageQuotaInputSchema.safeParse({ worldAssetQuotaBytes: 200 * MB, worldAssetCount: 10 }).success).toBe(
            false,
        );
    });

    it('選べる値はどれも範囲の中で、既定の値を含む', () => {
        for (const preset of WORLD_ASSET_QUOTA_PRESETS) expect(parse(preset).success).toBe(true);
        expect(WORLD_ASSET_QUOTA_PRESETS).toContain(WORLD_ASSET_QUOTA_BYTES.default);
    });
});

describe('StorageSettingsSchema', () => {
    it('真偽値だけを受ける（"false" の文字列を true にしない）', () => {
        expect(StorageSettingsSchema.safeParse({ autoCleanup: false }).data).toEqual({ autoCleanup: false });
        expect(StorageSettingsSchema.safeParse({ autoCleanup: 'false' }).success).toBe(false);
        expect(StorageSettingsSchema.safeParse({}).success).toBe(false);
    });
});
