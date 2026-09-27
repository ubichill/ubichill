import { DISPLAY_NAME_WEBFINGER_PROPERTY, SIGNING_KEY_WEBFINGER_PROPERTY } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createAuthorKeyDirectory, profileFromWebFinger } from './authorKeys';

const publicKeyFromWebFinger = (jrd: unknown, account: string) => profileFromWebFinger(jrd, account)?.signingPublicKey;

const KEY = 'A'.repeat(43);
const jrd = (subject: unknown, key: unknown = KEY) => ({
    subject,
    properties: { [SIGNING_KEY_WEBFINGER_PROPERTY]: key },
});

describe('publicKeyFromWebFinger', () => {
    it('問い合わせたアカウントの JRD から鍵を取り出す', () => {
        expect(publicKeyFromWebFinger(jrd('acct:youkan@ubichill.com'), 'youkan@ubichill.com')).toBe(KEY);
    });

    it('ドメインの大文字小文字は同一視する', () => {
        expect(publicKeyFromWebFinger(jrd('acct:youkan@UbiChill.com'), 'youkan@ubichill.com')).toBe(KEY);
    });

    it('別人の JRD（subject 不一致）は採用しない＝他人の鍵をすり替えられない', () => {
        expect(publicKeyFromWebFinger(jrd('acct:evil@ubichill.com'), 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger(jrd('acct:youkan@evil.com'), 'youkan@ubichill.com')).toBeUndefined();
    });

    it('subject・鍵が欠けている／形式不正なら undefined', () => {
        expect(publicKeyFromWebFinger(jrd(undefined), 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger(jrd('acct:youkan@ubichill.com', 'short'), 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger({ subject: 'acct:youkan@ubichill.com' }, 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger('not json', 'youkan@ubichill.com')).toBeUndefined();
        expect(publicKeyFromWebFinger(null, 'youkan@ubichill.com')).toBeUndefined();
    });
});

describe('createAuthorKeyDirectory', () => {
    const LOCAL = 'B'.repeat(43);
    const setup = (overrides: { allowHttp?: boolean; remote?: (url: string) => unknown } = {}) => {
        const calls = { local: 0, fetch: [] as string[] };
        const clock = { t: 0 };
        const resolver = createAuthorKeyDirectory({
            selfDomain: () => 'ubichill.com',
            findLocalAccount: async (handle) => {
                calls.local += 1;
                return handle === 'youkan' ? { signingPublicKey: LOCAL, displayName: 'ようかん' } : undefined;
            },
            fetchJson: async (url) => {
                calls.fetch.push(url);
                return overrides.remote ? overrides.remote(url) : undefined;
            },
            allowHttp: overrides.allowHttp ?? false,
            now: () => clock.t,
        });
        return { resolver, calls, clock };
    };

    it('自サーバーのアカウントは DB で引き、ネットワークに出ない', async () => {
        const { resolver, calls } = setup();
        expect(await resolver.resolve('youkan@ubichill.com')).toBe(LOCAL);
        expect(calls.fetch).toEqual([]);
    });

    it('他ドメインは https の WebFinger で引く（本番は http を試さない）', async () => {
        const { resolver, calls } = setup({ remote: () => undefined });
        expect(await resolver.resolve('alice@other.example')).toBeUndefined();
        expect(calls.fetch).toEqual([
            'https://other.example/.well-known/webfinger?resource=acct%3Aalice%40other.example',
        ]);
    });

    it('開発時だけ https で取れなければ http も試す', async () => {
        const { resolver, calls } = setup({
            allowHttp: true,
            remote: (url) => (url.startsWith('http://') ? jrd('acct:alice@localhost:3101') : undefined),
        });
        expect(await resolver.resolve('alice@localhost:3101')).toBe(KEY);
        expect(calls.fetch.map((u) => u.split(':')[0])).toEqual(['https', 'http']);
    });

    it('取得に失敗（throw）しても undefined（作者を表示しない側に倒す）', async () => {
        const { resolver } = setup({
            remote: () => {
                throw new Error('down');
            },
        });
        expect(await resolver.resolve('alice@other.example')).toBeUndefined();
    });

    it('TTL 内はキャッシュし、invalidate または期限切れで引き直す', async () => {
        const { resolver, calls, clock } = setup();
        await resolver.resolve('youkan@ubichill.com');
        await resolver.resolve('@youkan@UbiChill.com'); // 表記ゆれも同じキャッシュ
        expect(calls.local).toBe(1);
        resolver.invalidate('youkan@ubichill.com');
        await resolver.resolve('youkan@ubichill.com');
        expect(calls.local).toBe(2);
        clock.t += 5 * 60 * 1000;
        await resolver.resolve('youkan@ubichill.com');
        expect(calls.local).toBe(3);
    });

    it('形式不正なアカウントは問い合わせない', async () => {
        const { resolver, calls } = setup();
        expect(await resolver.resolve('not an account')).toBeUndefined();
        expect(calls.local + calls.fetch.length).toBe(0);
    });
});

describe('表示名（作者名はアカウントから引く）', () => {
    it('WebFinger の表示名を取り出す', () => {
        const profile = profileFromWebFinger(
            { subject: 'acct:youkan@ubichill.com', properties: { [DISPLAY_NAME_WEBFINGER_PROPERTY]: 'ようかん' } },
            'youkan@ubichill.com',
        );
        expect(profile).toEqual({ displayName: 'ようかん' });
    });

    it('表示名が不正（制御文字・長すぎ・文字列でない）なら捨てる', () => {
        for (const bad of ['a\u0000b', 'x'.repeat(31), 42, '']) {
            const profile = profileFromWebFinger(
                { subject: 'acct:youkan@ubichill.com', properties: { [DISPLAY_NAME_WEBFINGER_PROPERTY]: bad } },
                'youkan@ubichill.com',
            );
            expect(profile?.displayName).toBeUndefined();
        }
    });

    it('自サーバーのアカウントは DB の表示名、無いアカウントは undefined', async () => {
        const directory = createAuthorKeyDirectory({
            selfDomain: () => 'ubichill.com',
            findLocalAccount: async (h) => (h === 'youkan' ? { displayName: 'ようかん' } : undefined),
            fetchJson: async () => undefined,
            allowHttp: false,
        });
        expect(await directory.displayName('youkan@ubichill.com')).toBe('ようかん');
        expect(await directory.displayName('nobody@ubichill.com')).toBeUndefined();
    });
});
