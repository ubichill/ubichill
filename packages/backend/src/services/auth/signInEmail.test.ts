import { describe, expect, it, vi } from 'vitest';
import { createSignInEmailResolver, UNKNOWN_HANDLE_EMAIL } from './signInEmail';

const findEmailByHandle = vi.fn(async (handle: string) => (handle === 'alice' ? 'alice@example.com' : null));
const resolve = createSignInEmailResolver({ findEmailByHandle });

describe('createSignInEmailResolver', () => {
    it('メールアドレスはそのまま（ID を探さない）', async () => {
        expect(await resolve('Alice@Example.com')).toBeNull();
        expect(findEmailByHandle).not.toHaveBeenCalled();
    });

    it('ID はその人のメールアドレスにする（大文字・前後の空白は問わない）', async () => {
        for (const input of ['alice', 'Alice', ' alice ']) expect(await resolve(input)).toBe('alice@example.com');
    });

    it('いない ID・空・長すぎるものは、誰のものでもないアドレスにする（メールアドレスと同じ失敗にする）', async () => {
        findEmailByHandle.mockClear();
        expect(await resolve('nobody')).toBe(UNKNOWN_HANDLE_EMAIL);
        expect(await resolve('  ')).toBe(UNKNOWN_HANDLE_EMAIL);
        expect(await resolve('a'.repeat(65))).toBe(UNKNOWN_HANDLE_EMAIL);
        expect(findEmailByHandle).toHaveBeenCalledTimes(1);
    });
});
