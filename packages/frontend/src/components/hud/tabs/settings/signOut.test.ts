import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const h = vi.hoisted(() => ({ signOutFails: false }));

vi.mock('@/lib/auth-client', () => ({
    signOut: vi.fn(async () => {
        calls.push('signOut');
        if (h.signOutFails) throw new Error('network');
    }),
}));
vi.mock('@/lib/home/homeStore', () => ({ resetHome: () => calls.push('resetHome') }));
vi.mock('@/lib/social/blocks', () => ({ resetBlocks: () => calls.push('resetBlocks') }));
vi.mock('@/components/worlds/useFavorites', () => ({ resetFavorites: () => calls.push('resetFavorites') }));
vi.mock('@/components/worlds/useInstances', () => ({ resetWorldsCache: () => calls.push('resetWorldsCache') }));

const { signOutAndReset } = await import('./signOut');

beforeEach(() => {
    calls.length = 0;
    h.signOutFails = false;
});

describe('signOutAndReset: ログアウトで持ち主ごとの状態を全部捨てる', () => {
    it('サインアウトしてから、ホーム・ブロック・お気に入り・ワールド一覧を 1 回ずつ捨てる', async () => {
        await signOutAndReset();
        expect(calls[0]).toBe('signOut');
        expect([...calls.slice(1)].sort()).toEqual(['resetBlocks', 'resetFavorites', 'resetHome', 'resetWorldsCache']);
    });

    it('続けて 2 回呼んでも、それぞれで全部捨てる', async () => {
        await Promise.all([signOutAndReset(), signOutAndReset()]);
        expect(calls.filter((c) => c === 'signOut')).toHaveLength(2);
        expect(calls.filter((c) => c === 'resetFavorites')).toHaveLength(2);
    });

    it('サインアウトに失敗したら（まだログインしている）何も捨てずに失敗を返す', async () => {
        h.signOutFails = true;
        await expect(signOutAndReset()).rejects.toThrow('network');
        expect(calls).toEqual(['signOut']);
    });
});
