import { eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { accounts, twoFactorChallenges, users } from '../schema';
import { twoFactorChallengeRepository, twoFactorRepository } from './twoFactorRepository';

/** 二段階認証の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const now = new Date();

const user = async (suffix: string) => {
    const id = `tf-${stamp}-${suffix}`;
    await db
        .insert(users)
        .values({ id, name: `TF ${stamp} ${suffix}`, email: `${id}@example.com`, handle: `tf${stamp}${suffix}` });
    return id;
};

const enable = (userId: string) =>
    twoFactorRepository.withLocked(userId, (_record, locked) =>
        locked.update({ enabledAt: now, backupCodeHashes: ['h1', 'h2'] }),
    );

describe.skipIf(!RUN)('twoFactorRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(users).where(like(users.id, `tf-${stamp}-%`));
    });

    it('設定の途中は始め直しで置き換えるが、有効になった鍵は上書きしない', async () => {
        const id = await user('a');
        expect(await twoFactorRepository.startSetup(id, 'secret-1', now)).toBe('started');
        expect(await twoFactorRepository.startSetup(id, 'secret-2', now)).toBe('started');
        expect((await twoFactorRepository.find(id))?.secret).toBe('secret-2');
        await enable(id);
        expect(await twoFactorRepository.startSetup(id, 'attacker', now)).toBe('already-enabled');
        expect(await twoFactorRepository.find(id)).toMatchObject({
            secret: 'secret-2',
            backupCodeHashes: ['h1', 'h2'],
        });
    });

    it('同じコードを同時に送っても、行ロックで 1 つずつ確かめるので通るのは 1 つだけ', async () => {
        const id = await user('b');
        await twoFactorRepository.startSetup(id, 's', now);
        await enable(id);
        const step = 1000;
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                twoFactorRepository.withLocked(id, async (record, locked) => {
                    if (record?.lastUsedStep !== null && (record?.lastUsedStep ?? 0) >= step) return false;
                    // 確かめている間に別の要求が割り込めないことを見るため、少し待つ
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    await locked.update({ lastUsedStep: step });
                    return true;
                }),
            ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await twoFactorRepository.find(id))?.lastUsedStep).toBe(step);
    });

    it('同じバックアップコードを同時に使っても、消せるのは 1 回だけ', async () => {
        const id = await user('c');
        await twoFactorRepository.startSetup(id, 's', now);
        await enable(id);
        const results = await Promise.all(
            Array.from({ length: 4 }, () =>
                twoFactorRepository.withLocked(id, async (record, locked) => {
                    if (!record?.backupCodeHashes.includes('h1')) return false;
                    await locked.update({ backupCodeHashes: record.backupCodeHashes.filter((h) => h !== 'h1') });
                    return true;
                }),
            ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await twoFactorRepository.find(id))?.backupCodeHashes).toEqual(['h2']);
    });

    it('ユーザーを消すと二段階認証と途中も消える', async () => {
        const id = await user('d');
        await twoFactorRepository.startSetup(id, 's', now);
        await twoFactorChallengeRepository.create({
            id: `${id}-ch`,
            userId: id,
            passwordVerified: true,
            authAccountId: null,
            remember: true,
            returnTo: null,
            expiresAt: new Date(now.getTime() + 60_000),
        });
        await db.delete(users).where(eq(users.id, id));
        expect(await twoFactorRepository.find(id)).toBeUndefined();
        expect(
            await db
                .select()
                .from(twoFactorChallenges)
                .where(eq(twoFactorChallenges.id, `${id}-ch`)),
        ).toEqual([]);
    });
});

describe.skipIf(!RUN)('twoFactorChallengeRepository (DB統合)', () => {
    const challenge = (userId: string, id: string, authAccountId: string | null = null, ttl = 60_000) =>
        twoFactorChallengeRepository.create({
            id,
            userId,
            passwordVerified: authAccountId === null,
            authAccountId,
            remember: true,
            returnTo: '/',
            expiresAt: new Date(Date.now() + ttl),
        });

    afterAll(async () => {
        await db.delete(users).where(like(users.id, `tf-${stamp}-%`));
    });

    it('試行は同時に送っても上限の回数までしか取れない', async () => {
        const id = await user('e');
        await challenge(id, `${id}-1`);
        const attempts = await Promise.all(
            Array.from({ length: 12 }, () => twoFactorChallengeRepository.beginAttempt(`${id}-1`, new Date(), 5)),
        );
        expect(attempts.filter(Boolean)).toHaveLength(5);
        expect(
            attempts
                .filter(Boolean)
                .map((a) => a?.attempts)
                .sort(),
        ).toEqual([1, 2, 3, 4, 5]);
    });

    it('使い切れるのは 1 回だけ。期限を過ぎたものは試せず使えない', async () => {
        const id = await user('f');
        await challenge(id, `${id}-1`);
        const consumed = await Promise.all([
            twoFactorChallengeRepository.consume(`${id}-1`, new Date()),
            twoFactorChallengeRepository.consume(`${id}-1`, new Date()),
        ]);
        expect(consumed.filter(Boolean)).toHaveLength(1);

        await challenge(id, `${id}-2`, null, -1000);
        expect(await twoFactorChallengeRepository.beginAttempt(`${id}-2`, new Date(), 5)).toBeUndefined();
        expect(await twoFactorChallengeRepository.consume(`${id}-2`, new Date())).toBeUndefined();
        await twoFactorChallengeRepository.deleteExpired(new Date());
        expect(
            await db
                .select()
                .from(twoFactorChallenges)
                .where(eq(twoFactorChallenges.id, `${id}-2`)),
        ).toEqual([]);
    });

    it('フェディバースで通った途中は、その外部アカウントを外すと消える', async () => {
        const id = await user('g');
        await db.insert(accounts).values({
            id: `${id}-acc`,
            accountId: 'ext',
            providerId: 'fediverse:https://mi.example',
            userId: id,
            createdAt: now,
            updatedAt: now,
        });
        await challenge(id, `${id}-1`, `${id}-acc`);
        await db.delete(accounts).where(eq(accounts.id, `${id}-acc`));
        expect(await twoFactorChallengeRepository.consume(`${id}-1`, new Date())).toBeUndefined();
    });
});
