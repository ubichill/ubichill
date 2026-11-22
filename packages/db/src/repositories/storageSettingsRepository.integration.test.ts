import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { storageSettings } from '../schema';
import { storageSettingsRepository } from './storageSettingsRepository';

/** ストレージの設定の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)('storageSettingsRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(storageSettings);
    });

    it('行が無ければ null。置くと 1 行を上書きし、10 GB を越える値も bigint で持てる', async () => {
        await db.delete(storageSettings);
        expect(await storageSettingsRepository.get()).toBeNull();

        await storageSettingsRepository.put({ worldAssetQuotaBytes: 1024 ** 3 }, new Date('2026-11-01T00:00:00Z'));
        await storageSettingsRepository.put({ worldAssetQuotaBytes: 10 * 1024 ** 3 }, new Date('2026-11-02T00:00:00Z'));
        expect(await storageSettingsRepository.get()).toEqual({
            worldAssetQuotaBytes: 10 * 1024 ** 3,
            updatedAt: new Date('2026-11-02T00:00:00Z'),
        });
        expect(await db.select().from(storageSettings)).toHaveLength(1);
    });
});
