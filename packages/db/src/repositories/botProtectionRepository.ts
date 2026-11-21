import { db } from '../index';
import { botProtectionSettings } from '../schema';

export interface BotProtectionRecord {
    provider: string;
    siteKey: string;
    /** 暗号化したシークレットキー */
    secret: string;
    updatedAt: Date;
}

const ID = 'current';

/** ボット対策の設定（1 行だけ。行が無ければ使わない）。 */
export const botProtectionRepository = {
    async get(): Promise<BotProtectionRecord | null> {
        const [row] = await db
            .select({
                provider: botProtectionSettings.provider,
                siteKey: botProtectionSettings.siteKey,
                secret: botProtectionSettings.secret,
                updatedAt: botProtectionSettings.updatedAt,
            })
            .from(botProtectionSettings);
        return row ?? null;
    },

    async put(input: { provider: string; siteKey: string; secret: string }, now = new Date()): Promise<void> {
        const values = { ...input, updatedAt: now };
        await db
            .insert(botProtectionSettings)
            .values({ id: ID, ...values })
            .onConflictDoUpdate({ target: botProtectionSettings.id, set: values });
    },

    async clear(): Promise<void> {
        await db.delete(botProtectionSettings);
    },
};
