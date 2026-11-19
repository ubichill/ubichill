import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { accounts, externalAccountProfiles, fediverseOauthClients, users, verifications } from '../schema';
import { insertCredentialUser } from './credentialUser';
import { authFlowRepository, fediverseAccountRepository, type NewFediverseUser } from './fediverseAccountRepository';

/** フェディバースのログインの DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const now = new Date();
const origin = `https://mi-${stamp}.example`;

const newUser = (suffix: string, accountId = suffix): NewFediverseUser => ({
    userId: `fu-${stamp}-${suffix}`,
    accountRowId: `fa-${stamp}-${suffix}`,
    email: `${stamp}${suffix}@sso.invalid`,
    name: `F ${stamp} ${suffix}`,
    handle: `f${stamp}${suffix}`.slice(0, 30),
    displayNameKey: `f ${stamp} ${suffix}`,
    identity: { providerId: `fediverse:${origin}`, accountId, software: 'misskey', username: `alice${suffix}` },
    now,
});

describe.skipIf(!RUN)('fediverseAccountRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(users).where(like(users.id, `%-${stamp}-%`));
        await db.delete(fediverseOauthClients).where(eq(fediverseOauthClients.origin, origin));
        await db.delete(verifications).where(like(verifications.identifier, `test-${stamp}%`));
    });

    it('メールなしのユーザーと外部アカウントを一緒に作り、同じ外部 ID で同時に作っても 1 人になる', async () => {
        const results = await Promise.all([
            fediverseAccountRepository.createUser(newUser('a', 'same')),
            fediverseAccountRepository.createUser(newUser('b', 'same')),
            fediverseAccountRepository.createUser(newUser('c', 'same')),
        ]);
        const created = results.filter((r) => r.status === 'created');
        expect(created).toHaveLength(1);
        const owner = await fediverseAccountRepository.findUserByIdentity(newUser('x', 'same').identity, now);
        expect(
            results.filter((r) => r.status === 'identity-taken').every((r) => 'userId' in r && r.userId === owner),
        ).toBe(true);
        // 負けた方のユーザーの行は残らない（トランザクションごと戻る）
        const rows = await db
            .select({ id: users.id, emailVerified: users.emailVerified })
            .from(users)
            .where(inArray(users.id, [`fu-${stamp}-a`, `fu-${stamp}-b`, `fu-${stamp}-c`]));
        expect(rows).toEqual([{ id: owner, emailVerified: false }]);
    });

    it('同じ外部アカウント・同じ ID で同時に送っても、負けた方は既存のユーザーを返す', async () => {
        const results = await Promise.all([
            fediverseAccountRepository.createUser(newUser('s1', 'same-handle')),
            fediverseAccountRepository.createUser({ ...newUser('s2', 'same-handle'), handle: newUser('s1').handle }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual(['created', 'identity-taken']);
    });

    it('ID の重複は handle-taken で、外部アカウントは作られない', async () => {
        await fediverseAccountRepository.createUser(newUser('d'));
        const dup = { ...newUser('e'), handle: newUser('d').handle };
        expect(await fediverseAccountRepository.createUser(dup)).toEqual({ status: 'handle-taken' });
        expect(await fediverseAccountRepository.findUserByIdentity(dup.identity, now)).toBeUndefined();
    });

    it('別のユーザーの外部アカウントは連携で移らず、同じユーザーなら already-linked', async () => {
        await fediverseAccountRepository.createUser(newUser('f'));
        const identity = newUser('f').identity;
        await fediverseAccountRepository.createUser(newUser('g'));
        const steal = await fediverseAccountRepository.link({
            userId: `fu-${stamp}-g`,
            accountRowId: `fa-${stamp}-g2`,
            identity,
            now,
        });
        expect(steal).toEqual({ status: 'linked-to-other' });
        const again = await fediverseAccountRepository.link({
            userId: `fu-${stamp}-f`,
            accountRowId: `fa-${stamp}-f2`,
            identity,
            now,
        });
        expect(again).toEqual({ status: 'already-linked' });
    });

    it('ログインで改名に追従する', async () => {
        await fediverseAccountRepository.createUser(newUser('h'));
        await fediverseAccountRepository.findUserByIdentity({ ...newUser('h').identity, username: 'renamed' }, now);
        const [profile] = await db
            .select()
            .from(externalAccountProfiles)
            .where(eq(externalAccountProfiles.accountId, `fa-${stamp}-h`));
        expect(profile?.username).toBe('renamed');
    });

    it('最後のログイン手段は外せない。2 つあるとき同時に外しても 1 つは残る', async () => {
        await fediverseAccountRepository.createUser(newUser('i'));
        const userId = `fu-${stamp}-i`;
        expect(await fediverseAccountRepository.unlink(userId, `fa-${stamp}-i`)).toEqual({ status: 'last-method' });

        await fediverseAccountRepository.link({
            userId,
            accountRowId: `fa-${stamp}-i2`,
            identity: { ...newUser('i').identity, accountId: 'i-second' },
            now,
        });
        const results = await Promise.all([
            fediverseAccountRepository.unlink(userId, `fa-${stamp}-i`),
            fediverseAccountRepository.unlink(userId, `fa-${stamp}-i2`),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual(['last-method', 'unlinked']);
        expect(await fediverseAccountRepository.listLinked(userId)).toHaveLength(1);
    });

    it('パスワードの行は unlink で外せず、ほかの人の外部アカウントも外せない', async () => {
        const userId = `fu-${stamp}-p`;
        await db.transaction((tx) =>
            insertCredentialUser(tx, {
                userId,
                accountId: `fa-${stamp}-p`,
                email: `p-${stamp}@example.com`,
                name: `P ${stamp}`,
                handle: `p${stamp}`,
                displayNameKey: `p ${stamp}`,
                passwordHash: 'x',
                now,
            }),
        );
        expect(await fediverseAccountRepository.hasPassword(userId)).toBe(true);
        expect(await fediverseAccountRepository.unlink(userId, `fa-${stamp}-p`)).toEqual({ status: 'not-found' });
        await fediverseAccountRepository.createUser(newUser('q'));
        expect(await fediverseAccountRepository.unlink(userId, `fa-${stamp}-q`)).toEqual({ status: 'not-found' });
        expect(await fediverseAccountRepository.hasPassword(`fu-${stamp}-q`)).toBe(false);
        const [row] = await db
            .select()
            .from(accounts)
            .where(eq(accounts.id, `fa-${stamp}-q`));
        expect(row).toBeDefined();
    });

    it('アプリの登録は先に保存した方を使う', async () => {
        const a = await fediverseAccountRepository.saveClient({
            origin,
            redirectUri: 'r',
            clientId: 'a',
            clientSecret: 's',
        });
        const b = await fediverseAccountRepository.saveClient({
            origin,
            redirectUri: 'r',
            clientId: 'b',
            clientSecret: 't',
        });
        expect(a).toEqual({ clientId: 'a', clientSecret: 's' });
        expect(b).toEqual(a);
        await fediverseAccountRepository.forgetClient(origin, 'r');
        expect(await fediverseAccountRepository.findClient(origin, 'r')).toBeUndefined();
    });

    it('認証の途中の値は一度しか取り出せず、期限切れは返さない', async () => {
        const id = `test-${stamp}-take`;
        await authFlowRepository.put(id, 'v', new Date(now.getTime() + 60_000), `v-${stamp}-1`);
        const taken = await Promise.all([authFlowRepository.take(id, now), authFlowRepository.take(id, now)]);
        expect(taken.filter((v) => v === 'v')).toHaveLength(1);

        const expired = `test-${stamp}-expired`;
        await authFlowRepository.put(expired, 'v', new Date(now.getTime() - 1), `v-${stamp}-2`);
        expect(await authFlowRepository.peek(expired, now)).toBeUndefined();
        expect(await authFlowRepository.take(expired, now)).toBeUndefined();
    });
});
