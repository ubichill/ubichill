import { eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { accounts, retiredAccounts, sessions, userProfiles, users } from '../schema';
import { accountDeletionRepository } from './accountDeletionRepository';

/** 退会の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);

describe.skipIf(!RUN)('accountDeletionRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(retiredAccounts).where(like(retiredAccounts.userId, `del-${stamp}%`));
        await db.delete(users).where(like(users.id, `del-${stamp}%`));
    });

    it('ユーザーと持ち物を消し、ID とユーザー ID を退会の記録に残す', async () => {
        const id = `del-${stamp}-a`;
        const handle = `d${stamp}a`;
        await db.insert(users).values({ id, name: `D ${stamp}`, email: `${id}@example.com`, handle });
        await db.insert(accounts).values({ id: `${id}-acc`, accountId: id, providerId: 'credential', userId: id });
        await db
            .insert(sessions)
            .values({ id: `${id}-s`, token: `${id}-t`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
        await db.insert(userProfiles).values({ userId: id, status: 'hi' });

        expect(await accountDeletionRepository.retire(id)).toEqual({ status: 'retired', handle });
        expect(await db.select().from(users).where(eq(users.id, id))).toEqual([]);
        expect(await db.select().from(accounts).where(eq(accounts.userId, id))).toEqual([]);
        expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toEqual([]);
        expect(await db.select().from(userProfiles).where(eq(userProfiles.userId, id))).toEqual([]);
        expect(await accountDeletionRepository.isHandleRetired(handle)).toBe(true);
        expect(await accountDeletionRepository.isUserRetired(id)).toBe(true);
        expect(await accountDeletionRepository.isHandleRetired(`x${stamp}`)).toBe(false);
    });

    it('同時に消しても 1 回だけ。いないユーザーは not-found', async () => {
        const id = `del-${stamp}-b`;
        await db.insert(users).values({ id, name: `E ${stamp}`, email: `${id}@example.com`, handle: `d${stamp}b` });
        const results = await Promise.all([accountDeletionRepository.retire(id), accountDeletionRepository.retire(id)]);
        expect(results.map((r) => r.status).sort()).toEqual(['not-found', 'retired']);
        expect(await accountDeletionRepository.retire(`del-${stamp}-none`)).toEqual({ status: 'not-found' });
    });
});
