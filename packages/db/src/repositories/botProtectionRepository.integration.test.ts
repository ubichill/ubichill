import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { botProtectionSettings } from '../schema';
import { botProtectionRepository } from './botProtectionRepository';

/** ボット対策の設定の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)('botProtectionRepository (DB統合)', () => {
    afterAll(async () => {
        await botProtectionRepository.clear();
    });

    it('保存し直すと 1 行のまま置き換わり、消すと無くなる', async () => {
        await botProtectionRepository.clear();
        expect(await botProtectionRepository.get()).toBeNull();

        await botProtectionRepository.put({ provider: 'turnstile', siteKey: 'site-1', secret: 'sealed-1' });
        await Promise.all([
            botProtectionRepository.put({ provider: 'hcaptcha', siteKey: 'site-2', secret: 'sealed-2' }),
            botProtectionRepository.put({ provider: 'hcaptcha', siteKey: 'site-2', secret: 'sealed-2' }),
        ]);
        expect(await botProtectionRepository.get()).toMatchObject({
            provider: 'hcaptcha',
            siteKey: 'site-2',
            secret: 'sealed-2',
        });
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(botProtectionSettings);
        expect(count).toBe(1);

        await botProtectionRepository.clear();
        expect(await botProtectionRepository.get()).toBeNull();
    });

    it('2 行目は置けない', async () => {
        await expect(
            db.insert(botProtectionSettings).values({ id: 'other', provider: 'turnstile', siteKey: 's', secret: 'x' }),
        ).rejects.toThrow();
    });
});
