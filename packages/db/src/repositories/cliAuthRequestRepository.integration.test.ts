import { describe, expect, it } from 'vitest';
import { cliAuthRequestRepository } from './cliAuthRequestRepository';
import { userRepository } from './userRepository';

/** CLI 認可の要求の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);

describe.skipIf(!RUN)('cliAuthRequestRepository (DB統合)', () => {
    const base = (id: string, expiresAt: Date) => ({
        id,
        kind: 'cli',
        name: 'CLI',
        publicKey: `K${id}`.padEnd(43, 'K').slice(0, 43),
        redirectUri: null,
        codeChallenge: null,
        userCode: null,
        deviceCodeHash: null,
        expiresAt,
    });

    it('承認は承認待ちのものだけ、引き換えは承認済みのものを 1 回だけ（同時に送っても 1 つしか通らない）', async () => {
        const userId = `cli-it-${stamp}`;
        await userRepository.create({ id: userId, name: userId, email: `${userId}@example.com` });
        try {
            const id = `req-${stamp}`;
            await cliAuthRequestRepository.create(base(id, new Date(Date.now() + 60_000)));
            expect(await cliAuthRequestRepository.consume(id)).toBeUndefined(); // 承認前は引き換えられない
            expect(await cliAuthRequestRepository.approve(id, userId, 'hash')).toMatchObject({ status: 'approved' });
            expect(await cliAuthRequestRepository.approve(id, userId, 'hash')).toBeUndefined(); // 二重承認しない
            const results = await Promise.all([
                cliAuthRequestRepository.consume(id),
                cliAuthRequestRepository.consume(id),
                cliAuthRequestRepository.consume(id),
            ]);
            expect(results.filter(Boolean)).toHaveLength(1);
        } finally {
            await userRepository.deleteById(userId);
        }
    });

    it('失効した要求は見つからない扱いで、掃除で消える', async () => {
        const id = `expired-${stamp}`;
        await cliAuthRequestRepository.create(base(id, new Date(Date.now() - 1000)));
        expect(await cliAuthRequestRepository.findActive(id)).toBeUndefined();
        await cliAuthRequestRepository.deleteExpired();
        expect(await cliAuthRequestRepository.findActive(id, new Date(0))).toBeUndefined();
    });
});
