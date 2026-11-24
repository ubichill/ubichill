import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const h = vi.hoisted(() => ({ signOutFails: false, serverError: false }));
const forgetSession = () => calls.push('forgetSession');

vi.mock('@/lib/auth-client', () => ({
    signOut: vi.fn(async () => {
        calls.push('signOut');
        if (h.signOutFails) throw new Error('network');
        return { error: h.serverError ? { message: 'server error' } : null };
    }),
}));
vi.mock('@/lib/home/homeStore', () => ({ resetHome: () => calls.push('resetHome') }));
vi.mock('@/lib/social/blocks', () => ({ resetBlocks: () => calls.push('resetBlocks') }));
vi.mock('@/components/worlds/useFavorites', () => ({ resetFavorites: () => calls.push('resetFavorites') }));
vi.mock('@/components/worlds/useInstances', () => ({ resetWorldsCache: () => calls.push('resetWorldsCache') }));
vi.mock('@/lib/mods/modFavorites', () => ({ resetModFavorites: () => calls.push('resetModFavorites') }));

const { signOutAndReset } = await import('./signOut');

beforeEach(() => {
    calls.length = 0;
    h.signOutFails = false;
    h.serverError = false;
});

describe('signOutAndReset: ログアウトで持ち主ごとの状態を全部捨てる', () => {
    it('サインアウトしてから、ホーム・ブロック・お気に入り（ワールド・mod）・ワールド一覧を 1 回ずつ捨てる', async () => {
        await signOutAndReset(forgetSession);
        expect(calls[0]).toBe('signOut');
        expect([...calls.slice(1)].sort()).toEqual([
            'forgetSession',
            'resetBlocks',
            'resetFavorites',
            'resetHome',
            'resetModFavorites',
            'resetWorldsCache',
        ]);
    });

    it('続けて 2 回呼んでも、それぞれで全部捨てる', async () => {
        await Promise.all([signOutAndReset(forgetSession), signOutAndReset(forgetSession)]);
        expect(calls.filter((c) => c === 'signOut')).toHaveLength(2);
        expect(calls.filter((c) => c === 'resetFavorites')).toHaveLength(2);
    });

    it('サインアウトに失敗したら（まだログインしている）何も捨てずに失敗を返す', async () => {
        h.signOutFails = true;
        await expect(signOutAndReset(forgetSession)).rejects.toThrow('network');
        expect(calls).toEqual(['signOut']);
    });

    it('Better Auth が HTTP エラーを返した場合もキャッシュを消さない', async () => {
        h.serverError = true;
        await expect(signOutAndReset(forgetSession)).rejects.toThrow('server error');
        expect(calls).toEqual(['signOut']);
    });
});
