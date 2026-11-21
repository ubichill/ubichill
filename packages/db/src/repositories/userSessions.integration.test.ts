import { like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { accounts, externalAccountProfiles, sessions, users } from '../schema';
import { userRepository } from './userRepository';

/** ログイン中の端末の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const now = new Date();
const later = new Date(now.getTime() + 60_000);

describe.skipIf(!RUN)('ログイン中の端末 (DB統合)', () => {
    afterAll(async () => {
        await db.delete(users).where(like(users.id, `us-${stamp}-%`));
    });

    it('期限内のものを新しく使った順に返し、SSO なら外部アカウントを付ける。トークンは返さない', async () => {
        const id = `us-${stamp}-a`;
        await db.insert(users).values({ id, name: `US ${stamp}`, email: `${id}@example.com`, handle: `us${stamp}a` });
        await db.insert(accounts).values({
            id: `${id}-fa`,
            accountId: '99',
            providerId: 'fediverse:https://misskey.example',
            userId: id,
        });
        await db
            .insert(externalAccountProfiles)
            .values({ accountId: `${id}-fa`, software: 'misskey', username: 'alice', updatedAt: now });
        await db.insert(sessions).values([
            {
                id: `${id}-old`,
                token: `${id}-t1`,
                userId: id,
                expiresAt: later,
                updatedAt: new Date(now.getTime() - 5000),
                passwordVerifiedAt: now,
            },
            {
                id: `${id}-sso`,
                token: `${id}-t2`,
                userId: id,
                expiresAt: later,
                updatedAt: now,
                authAccountId: `${id}-fa`,
                userAgent: 'UA',
            },
            { id: `${id}-expired`, token: `${id}-t3`, userId: id, expiresAt: new Date(now.getTime() - 1000) },
        ]);
        const list = await userRepository.listSessions(id, now);
        expect(list.map((s) => s.id)).toEqual([`${id}-sso`, `${id}-old`]);
        expect(list[0]).toMatchObject({
            authProviderId: 'fediverse:https://misskey.example',
            authUsername: 'alice',
            userAgent: 'UA',
        });
        expect(list[1]).toMatchObject({ authProviderId: null, authUsername: null });
        expect(JSON.stringify(list)).not.toContain(`${id}-t`);
    });

    it('自分のセッションだけ消せる（ほかの人のセッション ID では消えない）', async () => {
        const a = `us-${stamp}-b`;
        const b = `us-${stamp}-c`;
        await db.insert(users).values([
            { id: a, name: `UB ${stamp}`, email: `${a}@example.com`, handle: `us${stamp}b` },
            { id: b, name: `UC ${stamp}`, email: `${b}@example.com`, handle: `us${stamp}c` },
        ]);
        await db.insert(sessions).values({ id: `${b}-s`, token: `${b}-t`, userId: b, expiresAt: later });
        expect(await userRepository.deleteSession(a, `${b}-s`)).toBe(false);
        expect(await userRepository.listSessions(b, now)).toHaveLength(1);
        expect(await userRepository.deleteSession(b, `${b}-s`)).toBe(true);
        expect(await userRepository.listSessions(b, now)).toHaveLength(0);
    });
});
