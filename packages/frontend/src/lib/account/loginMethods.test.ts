import type { LoginMethods } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { needsReauthentication, reauthenticationWay, removableLoginMethods } from './loginMethods';

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
    email: password ? 'alice@example.com' : null,
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

describe('reauthenticationWay（直近の本人確認のしかた）', () => {
    it('パスワードがあればパスワード（フェディバースでも入れる人も。SSO のログインは本人確認に数えない）', () => {
        expect(reauthenticationWay(methods(true, account('a')))).toEqual({ kind: 'password' });
    });

    it('パスワードが無ければ、今使える外部アカウントでログインし直す（使えないものは出さない）', () => {
        expect(reauthenticationWay(methods(false, account('a', false), account('b')))).toEqual({
            kind: 'fediverse',
            accounts: [account('b')],
        });
    });

    it('使える外部アカウントが無ければ、ログインし直すよう案内するだけ', () => {
        expect(reauthenticationWay(methods(false, account('a', false)))).toEqual({ kind: 'sign-in-again' });
    });

    it('ログイン方法を読めていなければパスワードを聞く（無ければサーバーがそう答える）', () => {
        expect(reauthenticationWay(null)).toEqual({ kind: 'password' });
    });
});

describe('needsReauthentication', () => {
    const stale = { ...methods(true), recentlyAuthenticated: false };

    it('直近に本人確認していなければ、操作の前に求める', () => {
        expect(needsReauthentication(stale, false)).toBe(true);
        expect(needsReauthentication(methods(true), false)).toBe(false);
    });

    it('読み込んだときは直近でも、サーバーに断られたら求める（画面を開いたまま 10 分を過ぎた）', () => {
        expect(needsReauthentication(methods(true), true)).toBe(true);
    });

    it('ログイン方法を読めなければ先には求めず、サーバーに任せる', () => {
        expect(needsReauthentication(null, false)).toBe(false);
        expect(needsReauthentication(null, true)).toBe(true);
    });
});
