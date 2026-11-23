import { db } from '../index';
import { storageSettings } from '../schema';

const ID = 'current';

/** ストレージの設定（1 行だけ。行が無ければ既定の値）。 */
export const storageSettingsRepository = {
    async get(): Promise<{ worldAssetQuotaBytes: number; updatedAt: Date } | null> {
        const [row] = await db
            .select({
                worldAssetQuotaBytes: storageSettings.worldAssetQuotaBytes,
                updatedAt: storageSettings.updatedAt,
            })
            .from(storageSettings);
        return row ?? null;
    },

    async put(input: { worldAssetQuotaBytes: number }, now = new Date()): Promise<void> {
        const values = { ...input, updatedAt: now };
        await db
            .insert(storageSettings)
            .values({ id: ID, ...values })
            .onConflictDoUpdate({ target: storageSettings.id, set: values });
    },
};
