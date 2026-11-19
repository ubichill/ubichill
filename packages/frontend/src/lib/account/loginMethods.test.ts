import type { LoginMethods } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { removableLoginMethods } from './loginMethods';

const account = (id: string, usable = true) => ({
    id,
    server: `${id}.example`,
    username: 'alice',
    software: 'misskey' as const,
    linkedAt: '',
    usable,
});
const methods = (password: boolean, ...fediverse: LoginMethods['fediverse']): LoginMethods => ({
    password,
    recentlyAuthenticated: true,
    fediverse,
});

describe('removableLoginMethods', () => {
    it('パスワードがあれば、どの外部アカウントも外せる', () => {
        expect([...removableLoginMethods(methods(true, account('a'), account('b', false)))]).toEqual(['a', 'b']);
    });

    it('外部アカウントだけなら、最後の使えるものは外せない', () => {
        expect([...removableLoginMethods(methods(false, account('a')))]).toEqual([]);
        expect([...removableLoginMethods(methods(false, account('a'), account('b')))]).toEqual(['a', 'b']);
    });

    it('使えない方しか残らないなら、使える方は外せず、使えない方は外せる', () => {
        expect([...removableLoginMethods(methods(false, account('a'), account('blocked', false)))]).toEqual([
            'blocked',
        ]);
    });
});
