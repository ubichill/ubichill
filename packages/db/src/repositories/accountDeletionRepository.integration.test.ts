import { eq, like, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { accounts, instances, retiredAccounts, sessions, userProfiles, users } from '../schema';
import { accountDeletionRepository } from './accountDeletionRepository';
import { fediverseAccountRepository } from './fediverseAccountRepository';
import { lockHandle } from './handleLock';
import { userRepository } from './userRepository';

/** 退会の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);

describe.skipIf(!RUN)('accountDeletionRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(retiredAccounts).where(like(retiredAccounts.userId, `del-${stamp}%`));
        await db.delete(users).where(like(users.id, `del-${stamp}%`));
    });

    const credentialUser = (id: string, handle: string) => ({
        userId: id,
        accountId: `${id}-acc`,
        email: `${id}@example.com`,
        name: `N ${id}`,
        handle,
        displayNameKey: `n ${id}`,
        passwordHash: 'hash',
        now: new Date(),
    });

    /** 誰かがロックを待つまで待つ（待たせた状態で次へ進むため） */
    const untilSomeoneWaits = async () => {
        for (let i = 0; i < 100; i++) {
            const [row] = await db.execute<{ n: number }>(
                sql`select count(*)::int as n from pg_locks where not granted`,
            );
            if ((row?.n ?? 0) > 0) return;
            await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error('ロックを待つ人が現れない');
    };

    it('ユーザーと持ち物を消し、ID とユーザー ID を退会の記録に残す', async () => {
        const id = `del-${stamp}-a`;
        const handle = `d${stamp}a`;
        await db.insert(users).values({ id, name: `D ${stamp}`, email: `${id}@example.com`, handle });
        await db.insert(accounts).values({ id: `${id}-acc`, accountId: id, providerId: 'credential', userId: id });
        await db
            .insert(sessions)
            .values({ id: `${id}-s`, token: `${id}-t`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
        await db.insert(userProfiles).values({ userId: id, status: 'hi' });
        await db.insert(instances).values({ id: `${id}-room`, worldRef: 'https://example.test/w', leaderId: id });

        // 一緒に消えた部屋を返す（Go の部屋を閉じるため）
        expect(await accountDeletionRepository.retire(id)).toEqual({
            status: 'retired',
            handle,
            roomIds: [`${id}-room`],
        });
        expect(await db.select().from(instances).where(eq(instances.leaderId, id))).toEqual([]);
        expect(await db.select().from(users).where(eq(users.id, id))).toEqual([]);
        expect(await db.select().from(accounts).where(eq(accounts.userId, id))).toEqual([]);
        expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toEqual([]);
        expect(await db.select().from(userProfiles).where(eq(userProfiles.userId, id))).toEqual([]);
        expect(await accountDeletionRepository.isHandleRetired(handle)).toBe(true);
        expect(await accountDeletionRepository.isUserRetired(id)).toBe(true);
        expect(await accountDeletionRepository.isHandleRetired(`x${stamp}`)).toBe(false);
    });

    it('退会した ID では、メールでも SSO でも作れない', async () => {
        const id = `del-${stamp}-c`;
        const handle = `d${stamp}c`;
        await db.insert(users).values({ id, name: `C ${stamp}`, email: `${id}@example.com`, handle });
        await accountDeletionRepository.retire(id);
        expect(await userRepository.createCredentialUser(credentialUser(`del-${stamp}-c2`, handle))).toBe(
            'handle-retired',
        );
        expect(
            await fediverseAccountRepository.createUser({
                userId: `del-${stamp}-c3`,
                accountRowId: `del-${stamp}-c3-acc`,
                email: `del${stamp}c3@sso.invalid`,
                name: `C3 ${stamp}`,
                handle,
                displayNameKey: `c3 ${stamp}`,
                identity: {
                    providerId: `fediverse:https://del-${stamp}.example`,
                    accountId: 'c3',
                    software: 'misskey',
                    username: 'c3',
                },
                now: new Date(),
                signUpLimit: { since: new Date(0), max: 1000 },
            }),
        ).toEqual({ status: 'handle-taken' });
        expect(await db.select().from(users).where(eq(users.handle, handle))).toEqual([]);
    });

    it('退会の途中に同じ ID で作ろうとしても、退会が終わるのを待って断る（入れ違いで退会した ID を取れない）', async () => {
        const id = `del-${stamp}-r`;
        const handle = `d${stamp}r`;
        await db.insert(users).values({ id, name: `R ${stamp}`, email: `${id}@example.com`, handle });
        // 退会と同じ手順を、users から消したところ（まだ確定していない）で止めておく
        const release = Promise.withResolvers<void>();
        const removed = Promise.withResolvers<void>();
        const retiring = db.transaction(async (tx) => {
            await lockHandle(tx, handle);
            await tx.insert(retiredAccounts).values({ userId: id, handle });
            await tx.delete(users).where(eq(users.id, id));
            removed.resolve();
            await release.promise;
        });
        await removed.promise;
        const creating = userRepository.createCredentialUser(credentialUser(`del-${stamp}-r2`, handle));
        await untilSomeoneWaits();
        release.resolve();
        await retiring;
        expect(await creating).toBe('handle-retired');
        expect(await db.select().from(users).where(eq(users.handle, handle))).toEqual([]);
    });

    it('同時に消しても 1 回だけ。いないユーザーは not-found', async () => {
        const id = `del-${stamp}-b`;
        await db.insert(users).values({ id, name: `E ${stamp}`, email: `${id}@example.com`, handle: `d${stamp}b` });
        const results = await Promise.all([accountDeletionRepository.retire(id), accountDeletionRepository.retire(id)]);
        expect(results.map((r) => r.status).sort()).toEqual(['not-found', 'retired']);
        expect(await accountDeletionRepository.retire(`del-${stamp}-none`)).toEqual({ status: 'not-found' });
    });
});
