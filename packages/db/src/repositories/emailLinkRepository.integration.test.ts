import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { accounts, emailLinkRequests, users } from '../schema';
import { emailLinkRepository } from './emailLinkRepository';

/** メールアドレスの追加の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const now = new Date();

const ssoUser = async (suffix: string) => {
    const id = `el-${stamp}-${suffix}`;
    await db
        .insert(users)
        .values({ id, name: `EL ${stamp} ${suffix}`, email: `${id}@sso.invalid`, handle: `el${stamp}${suffix}` });
    return id;
};

const request = (userId: string, email: string) => ({
    userId,
    email,
    passwordHash: 'hash',
    otpHash: 'otp',
    expiresAt: new Date(now.getTime() + 60_000),
});

describe.skipIf(!RUN)('emailLinkRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(users).where(like(users.id, `el-${stamp}-%`));
    });

    it('メールとパスワードを足す。ログインの形（credential・accountId はユーザー ID）で作り、確認待ちは消す', async () => {
        const id = await ssoUser('a');
        await emailLinkRepository.put(request(id, `a-${stamp}@example.com`));
        const outcome = await emailLinkRepository.withLocked(id, async (record, locked) => {
            expect(record?.email).toBe(`a-${stamp}@example.com`);
            const linked = await locked.link({
                email: record?.email ?? '',
                passwordHash: 'hash',
                accountId: `${id}-acc`,
                now,
            });
            await locked.remove();
            return linked;
        });
        expect(outcome).toBe('linked');
        const [user] = await db.select().from(users).where(eq(users.id, id));
        expect(user).toMatchObject({ email: `a-${stamp}@example.com`, emailVerified: true });
        const [password] = await db
            .select()
            .from(accounts)
            .where(and(eq(accounts.userId, id), eq(accounts.providerId, 'credential')));
        expect(password).toMatchObject({ accountId: id, password: 'hash' });
        expect(await emailLinkRepository.find(id)).toBeUndefined();
        // もう足してあるので、2 度目は足さない
        const again = await emailLinkRepository.withLocked(id, (_r, locked) =>
            locked.link({ email: `again-${stamp}@example.com`, passwordHash: 'h', accountId: `${id}-acc2`, now }),
        );
        expect(again).toBe('already-has-email');
    });

    it('ほかのユーザーが同じアドレスなら email-taken で、トランザクションは続く（確認待ちを消せる）', async () => {
        const taken = await ssoUser('t');
        await db
            .update(users)
            .set({ email: `taken-${stamp}@example.com`, emailVerified: true })
            .where(eq(users.id, taken));
        const id = await ssoUser('b');
        await emailLinkRepository.put(request(id, `taken-${stamp}@example.com`));
        const outcome = await emailLinkRepository.withLocked(id, async (record, locked) => {
            const linked = await locked.link({
                email: record?.email ?? '',
                passwordHash: 'h',
                accountId: `${id}-acc`,
                now,
            });
            await locked.remove();
            return linked;
        });
        expect(outcome).toBe('email-taken');
        expect(await emailLinkRepository.find(id)).toBeUndefined();
        const [user] = await db.select().from(users).where(eq(users.id, id));
        expect(user?.email).toBe(`${id}@sso.invalid`);
        expect(await db.select().from(accounts).where(eq(accounts.userId, id))).toEqual([]);
    });

    it('申し込み直すと置き換え、間違えた回数も戻る。期限切れは掃除で消える', async () => {
        const id = await ssoUser('c');
        await emailLinkRepository.put(request(id, `c1-${stamp}@example.com`));
        await emailLinkRepository.withLocked(id, (_r, locked) => locked.setFailures(3));
        await emailLinkRepository.put(request(id, `c2-${stamp}@example.com`));
        expect(await emailLinkRepository.find(id)).toMatchObject({ email: `c2-${stamp}@example.com`, failures: 0 });
        await db
            .update(emailLinkRequests)
            .set({ expiresAt: new Date(now.getTime() - 1000) })
            .where(eq(emailLinkRequests.userId, id));
        await emailLinkRepository.deleteExpired(now);
        expect(await emailLinkRepository.find(id)).toBeUndefined();
    });
});
