import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { serverInfo } from '../schema';
import { type ServerInfoRecord, serverInfoRepository } from './serverInfoRepository';

/** サーバーの情報の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;

const record = (name: string): ServerInfoRecord => ({
    name,
    description: '紹介',
    maintainerName: null,
    maintainerEmail: 'admin@example.com',
    tosUrl: null,
    privacyPolicyUrl: 'https://example.com/privacy',
    inquiryUrl: null,
    repositoryUrl: null,
    impressumUrl: null,
});

describe.skipIf(!RUN)('serverInfoRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(serverInfo);
    });

    it('保存し直すと 1 行のまま置き換わる', async () => {
        await db.delete(serverInfo);
        expect(await serverInfoRepository.get()).toBeNull();

        await serverInfoRepository.put(record('一つ目'));
        await Promise.all([serverInfoRepository.put(record('二つ目')), serverInfoRepository.put(record('二つ目'))]);
        expect(await serverInfoRepository.get()).toMatchObject(record('二つ目'));
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(serverInfo);
        expect(count).toBe(1);
    });

    it('2 行目は置けない', async () => {
        await expect(db.insert(serverInfo).values({ id: 'other', name: 'x' })).rejects.toThrow();
    });
});
