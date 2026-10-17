import { describe, expect, it } from 'vitest';
import {
    DEV_DEFAULT_PASSWORD,
    ensureOfficialAccount,
    type OfficialAccountDeps,
    officialAccountConfig,
} from './officialAccount';

interface FakeUser {
    id: string;
    email: string;
    handle: string;
    emailVerified: boolean;
    passwordChangeRequired: boolean;
    password?: string;
    publishingEnvironments?: number;
    /** その ID で公開したワールド・外部の作品の数 */
    published?: number;
}

function fakeDeps(state: { users?: FakeUser[]; takenNames?: string[] }) {
    const users = [...(state.users ?? [])];
    const calls = {
        signUp: [] as Array<{ email: string; handle: string; name: string; displayNameKey: string | null }>,
        initialize: [] as Array<{ id: string; fields: Record<string, unknown> }>,
        replaced: [] as Array<{ id: string; password: string }>,
        revoked: [] as string[],
    };
    const deps: OfficialAccountDeps = {
        findByHandle: async (h) => users.find((u) => u.handle === h),
        findByEmail: async (e) => users.find((u) => u.email === e),
        signUp: async ({ email, password, handle, name, displayNameKey }) => {
            calls.signUp.push({ email, handle, name, displayNameKey });
            users.push({
                id: `new-${email}`,
                email,
                handle,
                emailVerified: true,
                passwordChangeRequired: false,
                password,
            });
            return `new-${email}`;
        },
        hasPublished: async (id) => {
            const user = users.find((u) => u.id === id);
            return (user?.publishingEnvironments ?? 0) > 0 || (user?.published ?? 0) > 0;
        },
        passwordMatches: async (id, password) => users.find((u) => u.id === id)?.password === password,
        replacePassword: async (id, password) => {
            calls.replaced.push({ id, password });
        },
        revokeCredentials: async (id) => {
            calls.revoked.push(id);
            return users.find((u) => u.id === id)?.publishingEnvironments ?? 0;
        },
        isDisplayNameTaken: async (key) => (state.takenNames ?? []).includes(key),
        initialize: async (id, fields) => {
            calls.initialize.push({ id, fields });
        },
        log: () => undefined,
    };
    return { deps, calls };
}

const official = (overrides: Partial<FakeUser> = {}): FakeUser => ({
    id: 'u1',
    email: 'ubichill@ubichill.com',
    handle: 'ubichill',
    emailVerified: true,
    passwordChangeRequired: false,
    password: 'secret-1',
    ...overrides,
});

describe('officialAccountConfig', () => {
    it('Secret があればそれを使い、既定値扱いにしない', () => {
        expect(officialAccountConfig({ NODE_ENV: 'production', OFFICIAL_ACCOUNT_PASSWORD: 'secret-1' })).toEqual({
            email: 'ubichill@ubichill.com',
            password: 'secret-1',
            usingDevDefault: false,
        });
    });

    it('開発で未設定なら公開済みの既定値を使い、既定値であることを示す', () => {
        expect(officialAccountConfig({ NODE_ENV: 'development' })).toMatchObject({
            password: DEV_DEFAULT_PASSWORD,
            usingDevDefault: true,
        });
    });

    it('本番で未設定なら何もしない（推測できるパスワードで作らない）', () => {
        expect(officialAccountConfig({ NODE_ENV: 'production' })).toMatchObject({
            password: undefined,
            usingDevDefault: false,
        });
    });
});

describe('ensureOfficialAccount（パスワードは常に Secret が正）', () => {
    const config = { email: 'ubichill@ubichill.com', password: 'secret-1', usingDevDefault: false };

    it('無ければ Secret のパスワードで、ID・表示名を決めた状態で作る（ID の無い瞬間を作らない）', async () => {
        const { deps, calls } = fakeDeps({});
        expect(await ensureOfficialAccount(config, deps)).toBe('created');
        expect(calls.signUp).toEqual([
            { email: 'ubichill@ubichill.com', handle: 'ubichill', name: 'Ubichill', displayNameKey: 'ubichill' },
        ]);
        expect(calls.initialize).toEqual([]);
    });

    it('既定のパスワードで作ったときは「既定のパスワードのまま」を立てる', async () => {
        const { deps, calls } = fakeDeps({});
        await ensureOfficialAccount({ ...config, password: DEV_DEFAULT_PASSWORD, usingDevDefault: true }, deps);
        expect(calls.initialize).toEqual([
            { id: 'new-ubichill@ubichill.com', fields: { passwordChangeRequired: true } },
        ]);
    });

    it('Secret と同じなら何もしない（起動のたびにログインを切らない）', async () => {
        const { deps, calls } = fakeDeps({ users: [official()] });
        expect(await ensureOfficialAccount(config, deps)).toBe('unchanged');
        expect(calls.replaced).toEqual([]);
        expect(calls.initialize).toEqual([]);
    });

    it('Secret を差し替えたら次の起動でパスワードを置き換える（ログインは無効化）', async () => {
        const { deps, calls } = fakeDeps({ users: [official({ password: 'old' })] });
        expect(await ensureOfficialAccount(config, deps)).toBe('synced');
        expect(calls.replaced).toEqual([{ id: 'u1', password: 'secret-1' }]);
    });

    it('画面などで変えられていても、次の起動で Secret の値に戻す', async () => {
        const { deps, calls } = fakeDeps({ users: [official({ password: 'changed-in-ui' })] });
        await ensureOfficialAccount(config, deps);
        expect(calls.replaced).toHaveLength(1);
    });

    it('本番で Secret 未設定なら作らず、既存のパスワードにも触れない', async () => {
        const none = { ...config, password: undefined };
        const created = fakeDeps({});
        expect(await ensureOfficialAccount(none, created.deps)).toBe('skipped');
        expect(created.calls.signUp).toEqual([]);

        const existing = fakeDeps({ users: [official({ password: 'whatever' })] });
        expect(await ensureOfficialAccount(none, existing.deps)).toBe('unchanged');
        expect(existing.calls.replaced).toEqual([]);
    });

    it('既定値を使っている間だけ「既定のパスワードのまま」を立て、Secret を設定したら外す', async () => {
        const dev = { ...config, password: DEV_DEFAULT_PASSWORD, usingDevDefault: true };
        const onDev = fakeDeps({ users: [official({ password: DEV_DEFAULT_PASSWORD })] });
        await ensureOfficialAccount(dev, onDev.deps);
        expect(onDev.calls.initialize).toEqual([{ id: 'u1', fields: { passwordChangeRequired: true } }]);

        const onSecret = fakeDeps({ users: [official({ passwordChangeRequired: true })] });
        await ensureOfficialAccount(config, onSecret.deps);
        expect(onSecret.calls.initialize).toEqual([{ id: 'u1', fields: { passwordChangeRequired: false } }]);
    });

    it('同じメールのアカウントが、その ID で何も公開していなければ公式アカウントにし、パスワードも Secret に合わせる', async () => {
        const { deps, calls } = fakeDeps({
            users: [official({ id: 'm1', handle: 'user_0123456789ab', password: 'manual' })],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('attached');
        expect(calls.initialize[0]).toMatchObject({ id: 'm1', fields: { handle: 'ubichill' } });
        expect(calls.replaced).toEqual([{ id: 'm1', password: 'secret-1' }]);
    });

    it('メールアドレスを確認していないアカウントは、同じメールでも公式にしない', async () => {
        const { deps, calls } = fakeDeps({
            users: [official({ id: 'm1', handle: 'user_0123456789ab', emailVerified: false, password: 'attacker' })],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('skipped');
        expect(calls.initialize).toEqual([]);
        expect(calls.replaced).toEqual([]);
        expect(calls.revoked).toEqual([]);
    });

    it('先に作られていたアカウントを公式にするときは、それまでのログインを持ち越さない', async () => {
        const { deps, calls } = fakeDeps({
            users: [official({ id: 'm1', handle: 'user_0123456789ab', password: 'secret-1' })],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('attached');
        // パスワードが Secret と同じでも取り消す（パスワードの置き換えに頼らない）
        expect(calls.replaced).toEqual([]);
        expect(calls.revoked).toEqual(['m1']);
    });

    it('同じメールのアカウントが鍵を登録していれば（取り消し済みでも）、その ID の署名があり得るので付け替えない', async () => {
        const { deps, calls } = fakeDeps({
            users: [official({ id: 'm1', handle: 'user_0123456789ab', publishingEnvironments: 1 })],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('skipped');
        expect(calls.initialize).toEqual([]);
        expect(calls.revoked).toEqual([]);
    });

    it('すでに公式のアカウントは、起動のたびに鍵を取り消さない', async () => {
        const { deps, calls } = fakeDeps({ users: [official()] });
        await ensureOfficialAccount(config, deps);
        expect(calls.revoked).toEqual([]);
    });

    it('同じメールのアカウントが別の ID でワールドなどを公開していれば奪わない', async () => {
        const { deps, calls } = fakeDeps({ users: [official({ id: 'm1', handle: 'someone', published: 1 })] });
        expect(await ensureOfficialAccount(config, deps)).toBe('skipped');
        expect(calls.initialize).toEqual([]);
        expect(calls.replaced).toEqual([]);
    });

    it('表示名「Ubichill」が既に使われていれば一意キーは付けない（利用者の名前を奪わない）', async () => {
        const { deps, calls } = fakeDeps({ takenNames: ['ubichill'] });
        await ensureOfficialAccount(config, deps);
        expect(calls.signUp[0]).toMatchObject({ name: 'Ubichill', displayNameKey: null });
    });
});
