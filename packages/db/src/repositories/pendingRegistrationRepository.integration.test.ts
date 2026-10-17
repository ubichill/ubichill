import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { pendingRegistrations } from '../schema';
import { pendingRegistrationRepository } from './pendingRegistrationRepository';

/** 仮登録の DB 統合テスト（規則と本登録は backend の pendingRegistrations.integration.test.ts）。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);

describe.skipIf(!RUN)('pendingRegistrationRepository (DB統合)', () => {
    const email = `prr-${stamp}@example.com`;
    const record = (idHash: string, expiresAt: Date) => ({
        idHash,
        email,
        handle: `prr_${stamp}`,
        displayName: 'PRR',
        passwordHash: 'hash',
        otpHash: 'otp',
        failures: 2,
        expiresAt,
    });
    const find = async (idHash: string) =>
        (await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.idHash, idHash)))[0];

    afterAll(async () => {
        await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
    });

    it('期限切れは数えず、再送信もできず、掃除で消える。期限内のものは残る', async () => {
        const now = new Date();
        const expired = `expired-${stamp}`;
        const active = `active-${stamp}`;
        await pendingRegistrationRepository.withEmailLock(email, async (scope) => {
            await scope.insert(record(expired, new Date(now.getTime() - 1000)));
            await scope.insert(record(active, new Date(now.getTime() + 60_000)));
            expect(await scope.countActive(now)).toBe(1);
        });

        expect(await pendingRegistrationRepository.reissue(expired, 'new', new Date(now.getTime() + 60_000), now)).toBe(
            undefined,
        );
        expect(
            await pendingRegistrationRepository.reissue(active, 'new', new Date(now.getTime() + 120_000), now),
        ).toEqual({ email, displayName: 'PRR' });
        expect(await find(active)).toMatchObject({ otpHash: 'new', failures: 2 });

        await pendingRegistrationRepository.deleteExpired(now);
        expect(await find(expired)).toBeUndefined();
        expect(await find(active)).toBeDefined();
    });
});
