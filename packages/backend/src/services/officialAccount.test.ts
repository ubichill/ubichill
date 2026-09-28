import { describe, expect, it } from 'vitest';
import {
    DEV_INITIAL_PASSWORD,
    ensureOfficialAccount,
    type OfficialAccountDeps,
    officialAccountConfig,
} from './officialAccount';

const KEY = 'K'.repeat(43);

function fakeDeps(state: {
    users?: Array<{ id: string; email: string; handle: string | null; signingPublicKey: string | null }>;
    takenNames?: string[];
    officialPublicKey?: string;
}) {
    const users = [...(state.users ?? [])];
    const calls = { signUp: [] as string[], initialize: [] as Array<{ id: string; fields: Record<string, unknown> }> };
    const deps: OfficialAccountDeps = {
        findByHandle: async (h) => users.find((u) => u.handle === h),
        findByEmail: async (e) => users.find((u) => u.email === e),
        signUp: async (email) => {
            calls.signUp.push(email);
            users.push({ id: `new-${email}`, email, handle: null, signingPublicKey: null });
            return `new-${email}`;
        },
        isDisplayNameTaken: async (key) => (state.takenNames ?? []).includes(key),
        initialize: async (id, fields) => {
            calls.initialize.push({ id, fields });
        },
        officialPublicKey: state.officialPublicKey,
        log: () => undefined,
    };
    return { deps, calls };
}

describe('officialAccountConfig', () => {
    it('開発は既定の初期パスワード、本番は未設定なら作らない', () => {
        expect(officialAccountConfig({ NODE_ENV: 'development' }).initialPassword).toBe(DEV_INITIAL_PASSWORD);
        expect(officialAccountConfig({ NODE_ENV: 'production' }).initialPassword).toBeUndefined();
        expect(
            officialAccountConfig({ NODE_ENV: 'production', OFFICIAL_ACCOUNT_INITIAL_PASSWORD: 'secret-pass' })
                .initialPassword,
        ).toBe('secret-pass');
        expect(officialAccountConfig({}).email).toBe('ubichill@ubichill.com');
    });
});

describe('ensureOfficialAccount', () => {
    const config = { email: 'ubichill@ubichill.com', initialPassword: 'initial-pass' };

    it('無ければ初期パスワードで作り、ID・表示名・公式の鍵・初期パスワードのまま、を設定する', async () => {
        const { deps, calls } = fakeDeps({ officialPublicKey: KEY });
        expect(await ensureOfficialAccount(config, deps)).toBe('created');
        expect(calls.signUp).toEqual(['ubichill@ubichill.com']);
        expect(calls.initialize[0]?.fields).toMatchObject({
            handle: 'ubichill',
            name: 'Ubichill',
            displayNameKey: 'ubichill',
            signingPublicKey: KEY,
            emailVerified: true,
            passwordChangeRequired: true,
        });
    });

    it('既にあれば作らない（2回目以降の起動）', async () => {
        const { deps, calls } = fakeDeps({
            users: [{ id: 'u1', email: 'x@example.com', handle: 'ubichill', signingPublicKey: KEY }],
            officialPublicKey: KEY,
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('exists');
        expect(calls.signUp).toEqual([]);
        expect(calls.initialize).toEqual([]);
    });

    it('既存の公式アカウントに鍵が無ければ公式の鍵を入れ、別の鍵が登録済みなら触らない', async () => {
        const noKey = fakeDeps({
            users: [{ id: 'u1', email: 'x@example.com', handle: 'ubichill', signingPublicKey: null }],
            officialPublicKey: KEY,
        });
        await ensureOfficialAccount(config, noKey.deps);
        expect(noKey.calls.initialize).toEqual([{ id: 'u1', fields: { signingPublicKey: KEY } }]);

        const otherKey = fakeDeps({
            users: [{ id: 'u1', email: 'x@example.com', handle: 'ubichill', signingPublicKey: 'O'.repeat(43) }],
            officialPublicKey: KEY,
        });
        await ensureOfficialAccount(config, otherKey.deps);
        expect(otherKey.calls.initialize).toEqual([]);
    });

    it('本番で初期パスワード未設定なら作らない（推測できるパスワードで作らない）', async () => {
        const { deps, calls } = fakeDeps({});
        expect(await ensureOfficialAccount({ ...config, initialPassword: undefined }, deps)).toBe('skipped');
        expect(calls.signUp).toEqual([]);
    });

    it('同じメールのアカウントが ID 未設定で既にあれば公式アカウントにする（パスワードはそのまま）', async () => {
        const { deps, calls } = fakeDeps({
            users: [{ id: 'm1', email: 'ubichill@ubichill.com', handle: null, signingPublicKey: null }],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('attached');
        expect(calls.signUp).toEqual([]);
        expect(calls.initialize[0]).toMatchObject({ id: 'm1', fields: { handle: 'ubichill' } });
        expect(calls.initialize[0]?.fields).not.toHaveProperty('passwordChangeRequired');
    });

    it('同じメールのアカウントが別の ID を持っていれば奪わない', async () => {
        const { deps, calls } = fakeDeps({
            users: [{ id: 'm1', email: 'ubichill@ubichill.com', handle: 'someone', signingPublicKey: null }],
        });
        expect(await ensureOfficialAccount(config, deps)).toBe('skipped');
        expect(calls.initialize).toEqual([]);
    });

    it('表示名「Ubichill」が既に使われていれば、表示名の一意キーは付けない（利用者の名前を奪わない）', async () => {
        const { deps, calls } = fakeDeps({ takenNames: ['ubichill'] });
        await ensureOfficialAccount(config, deps);
        expect(calls.initialize[0]?.fields).toMatchObject({ name: 'Ubichill', displayNameKey: null });
    });
});
