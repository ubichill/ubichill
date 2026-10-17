import { accounts, db, pendingRegistrations, userRepository, users } from '@ubichill/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 仮登録（Postgres）と better-auth の結合テスト。DATABASE_URL がある時だけ走る。
 * 本登録は better-auth を通らずに users / accounts を直接書くので、better-auth を更新して形がずれたらここで落ちる。
 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const PASSWORD = 'correct horse battery';

describe.skipIf(!RUN)('仮登録（DB統合）', () => {
    // lib/auth は読み込んだ時点で環境変数を検証するので、走らせるときだけ読み込む（スキップ時に落とさない）
    const loaded: { module?: typeof import('../lib/auth') } = {};
    beforeAll(async () => {
        loaded.module = await import('../lib/auth');
    });
    const authModule = () => {
        if (!loaded.module) throw new Error('lib/auth が読み込まれていない');
        return loaded.module;
    };
    const auth = () => authModule().auth;
    const getPendingRegistrations = () => authModule().getPendingRegistrations();
    const emails: string[] = [];
    const register = async (tag: string, overrides: { email?: string; handle?: string } = {}) => {
        const email = overrides.email ?? `pr-${tag}-${stamp}@example.com`;
        emails.push(email.toLowerCase());
        const ctx = await auth().$context;
        const store = await getPendingRegistrations();
        const result = await store.add({
            email,
            passwordHash: await ctx.password.hash(PASSWORD),
            displayName: `PR ${tag} ${stamp}`,
            handle: overrides.handle ?? `pr_${tag}_${stamp}`,
        });
        return { store, result, email: email.toLowerCase() };
    };
    const added = (result: { id: string; otp: string } | { error: string }) => {
        if ('error' in result) throw new Error(result.error);
        return result;
    };
    const pendingCount = async (email: string) =>
        (await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.email, email))).length;

    afterAll(async () => {
        for (const email of emails) {
            const user = await userRepository.findByEmail(email);
            if (user) await userRepository.deleteById(user.id);
            await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
        }
    });

    it('直接作ったユーザーで better-auth のログインが通り、確認済み・handle・表示名キーが入っている', async () => {
        const { store, result, email } = await register('signin', { email: `PR-SignIn-${stamp}@Example.com` });
        const { id, otp } = added(result);
        const outcome = await store.verify(id, otp);
        expect(outcome).toMatchObject({ status: 'verified', email });

        const signedIn = await auth().api.signInEmail({ body: { email, password: PASSWORD } });
        expect(signedIn.user.email).toBe(email);
        expect(signedIn.token).toBeTruthy();
        // 大文字が混じった入力でもログインできる（better-auth は小文字で引く）
        await expect(
            auth().api.signInEmail({ body: { email: `PR-SignIn-${stamp}@Example.com`, password: PASSWORD } }),
        ).resolves.toMatchObject({ user: { email } });
        await expect(auth().api.signInEmail({ body: { email, password: 'wrong password!' } })).rejects.toThrow();

        const user = await userRepository.findByEmail(email);
        expect(user).toMatchObject({
            emailVerified: true,
            handle: `pr_signin_${stamp}`,
            name: `PR signin ${stamp}`,
            displayNameKey: `pr signin ${stamp}`,
        });
        expect(await pendingCount(email)).toBe(0);
    });

    it('メール確認を通さない作成（公式アカウント・SKIP_EMAIL_VERIFICATION）も同じ形で、handle の重複なら何も残さない', async () => {
        const ctx = await auth().$context;
        const email = `pr-direct-${stamp}@example.com`;
        const other = `pr-direct-dup-${stamp}@example.com`;
        emails.push(email, other);
        const input = async (address: string) => ({
            userId: authModule().newBetterAuthId(ctx, 'user'),
            accountId: authModule().newBetterAuthId(ctx, 'account'),
            email: address,
            name: `PR direct ${address}`,
            handle: `pr_direct_${stamp}`,
            displayNameKey: null,
            passwordHash: await ctx.password.hash(PASSWORD),
            now: new Date(),
        });
        await userRepository.createCredentialUser(await input(email));
        await expect(auth().api.signInEmail({ body: { email, password: PASSWORD } })).resolves.toMatchObject({
            user: { email },
        });
        expect(await userRepository.findByEmail(email)).toMatchObject({ handle: `pr_direct_${stamp}` });

        const duplicate = await input(other);
        await expect(userRepository.createCredentialUser(duplicate)).rejects.toThrow();
        expect(await userRepository.findByEmail(other)).toBeUndefined();
        expect(await db.select().from(accounts).where(eq(accounts.id, duplicate.accountId))).toEqual([]);
    });

    it('better-auth の signUpEmail は handle を渡せないので、users を作る前に失敗する', async () => {
        const email = `pr-signup-${stamp}@example.com`;
        emails.push(email);
        await expect(auth().api.signUpEmail({ body: { email, password: PASSWORD, name: 'x' } })).rejects.toThrow();
        expect(await userRepository.findByEmail(email)).toBeUndefined();
    });

    it('同時に 5 件申し込んでも 3 件までしか入らない', async () => {
        const email = `pr-burst-${stamp}@example.com`;
        const results = await Promise.all(
            [0, 1, 2, 3, 4].map((i) => register(`burst${i}`, { email: i % 2 ? email.toUpperCase() : email })),
        );
        expect(results.filter((r) => 'id' in r.result)).toHaveLength(3);
        expect(results.filter((r) => 'error' in r.result)).toHaveLength(2);
        expect(await pendingCount(email)).toBe(3);
    });

    it('同じコードで同時に 2 回確認しても本登録は 1 回だけ', async () => {
        const { store, result, email } = await register('race');
        const { id, otp } = added(result);
        const outcomes = await Promise.all([store.verify(id, otp), store.verify(id, otp)]);
        expect(outcomes.map((o) => o.status).sort()).toEqual(['not-found', 'verified']);
        expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
    });

    it('本登録が一意制約で失敗したら仮登録は残り、原因が解ければ同じコードで登録できる', async () => {
        const handle = `pr_taken_${stamp}`;
        const squatter = `pr-squatter-${stamp}`;
        await userRepository.create({ id: squatter, name: squatter, email: `${squatter}@example.com`, handle });
        try {
            const { store, result, email } = await register('taken', { handle });
            const { id, otp } = added(result);
            expect(await store.verify(id, otp)).toMatchObject({ status: 'register-failed' });
            expect(await userRepository.findByEmail(email)).toBeUndefined();
            const [row] = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.email, email));
            expect(row?.failures).toBe(0);

            await userRepository.deleteById(squatter);
            expect(await store.verify(id, otp)).toMatchObject({ status: 'verified' });
        } finally {
            await userRepository.deleteById(squatter);
        }
    });

    it('間違えたコードの回数は DB に残り、再送信しても戻らない', async () => {
        const { store, result, email } = await register('fail');
        const { id } = added(result);
        for (const code of ['000000', '000001', '000002', '000003']) {
            expect(await store.verify(id, code)).toEqual({ status: 'wrong-code' });
        }
        const reissued = await store.reissue(id);
        expect(reissued).toMatchObject({ email });
        expect(await store.verify(id, '000004')).toEqual({ status: 'too-many-failures' });
        expect(await store.verify(id, reissued?.otp ?? '')).toEqual({ status: 'not-found' });
        expect(await pendingCount(email)).toBe(0);
    });
});
