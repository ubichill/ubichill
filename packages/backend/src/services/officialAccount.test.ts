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
    handle: string | null;
    passwordChangeRequired: boolean;
    password?: string;
}

function fakeDeps(state: { users?: FakeUser[]; takenNames?: string[] }) {
    const users = [...(state.users ?? [])];
    const calls = {
        signUp: [] as string[],
        initialize: [] as Array<{ id: string; fields: Record<string, unknown> }>,
        replaced: [] as Array<{ id: string; password: string }>,
        keysSynced: [] as string[],
    };
    const deps: OfficialAccountDeps = {
        findByHandle: async (h) => users.find((u) => u.handle === h),
        findByEmail: async (e) => users.find((u) => u.email === e),
        signUp: async (email, password) => {
            calls.signUp.push(email);
            users.push({
                id: `new-${email}`,
                email,
                handle: null,
                passwordChangeRequired: false,
                password,
            });
            return `new-${email}`;
        },
        passwordMatches: async (id, password) => users.find((u) => u.id === id)?.password === password,
        replacePassword: async (id, password) => {
            calls.replaced.push({ id, password });
        },
        isDisplayNameTaken: async (key) => (state.takenNames ?? []).includes(key),
        initialize: async (id, fields) => {
            calls.initialize.push({ id, fields });
        },
        syncSigningKeys: async (id) => {
            calls.keysSynced.push(id);
        },
        log: () => undefined,
    };
    return { deps, calls };
}

const official = (overrides: Partial<FakeUser> = {}): FakeUser => ({
    id: 'u1',
    email: 'ubichill@ubichill.com',
    handle: 'ubichill',
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

    it('無ければ Secret のパスワードで作り、ID・表示名を設定して公式の鍵に合わせる', async () => {
        const { deps, calls } = fakeDeps({});
        expect(await ensureOfficialAccount(config, deps)).toBe('created');
        expect(calls.signUp).toEqual(['ubichill@ubichill.com']);
        expect(calls.initialize[0]?.fields).toMatchObject({
            handle: 'ubichill',
            name: 'Ubichill',
            displayNameKey: 'ubichill',
            emailVerified: true,
            passwordChangeRequired: false,
        });
        expect(calls.keysSynced).toEqual(['new-ubichill@ubichill.com']);
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

    it('既存の公式アカウントも起動のたびに公式の鍵へ合わせる（記録で取り消した鍵を反映する）', async () => {
        const { deps, calls } = fakeDeps({ users: [official()] });
        await ensureOfficialAccount(config, deps);
        expect(calls.keysSynced).toEqual(['u1']);
    });

    it('同じメールのアカウントが ID 未設定で既にあれば公式アカウントにし、パスワードも Secret に合わせる', async () => {
        const { deps, calls } = fakeDeps({
            users: [official({ id: 'm1', handle: null, password: 'manual' })],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('attached');
        expect(calls.initialize[0]).toMatchObject({ id: 'm1', fields: { handle: 'ubichill' } });
        expect(calls.replaced).toEqual([{ id: 'm1', password: 'secret-1' }]);
        expect(calls.keysSynced).toEqual(['m1']);
    });

    it('同じメールのアカウントが別の ID を持っていれば奪わない', async () => {
        const { deps, calls } = fakeDeps({ users: [official({ id: 'm1', handle: 'someone' })] });
        expect(await ensureOfficialAccount(config, deps)).toBe('skipped');
        expect(calls.initialize).toEqual([]);
        expect(calls.replaced).toEqual([]);
        expect(calls.keysSynced).toEqual([]);
    });

    it('表示名「Ubichill」が既に使われていれば一意キーは付けない（利用者の名前を奪わない）', async () => {
        const { deps, calls } = fakeDeps({ takenNames: ['ubichill'] });
        await ensureOfficialAccount(config, deps);
        expect(calls.initialize[0]?.fields).toMatchObject({ name: 'Ubichill', displayNameKey: null });
    });
});
