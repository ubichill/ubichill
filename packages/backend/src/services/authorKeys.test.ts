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

describe('createAuthorKeyDirectory（確認は初回と鍵変更時だけ）', () => {
    const LOCAL = 'B'.repeat(43);
    const REMOTE = 'C'.repeat(43);
    const ROTATED = 'D'.repeat(43);
    const PINNED = 'E'.repeat(43);

    const setup = (options: { allowHttp?: boolean; remote?: (url: string) => unknown } = {}) => {
        const calls = { fetch: [] as string[], saved: [] as string[], refreshed: [] as string[] };
        const clock = { t: 1_000_000 };
        const store = new Map<string, { publicKey: string; displayName?: string | null; refreshedAt: Date }>();
        const directory = createAuthorKeyDirectory({
            selfDomain: () => 'ubichill.com',
            findLocalAccount: async (handle) =>
                handle === 'youkan' ? { signingPublicKey: LOCAL, displayName: 'ようかん' } : undefined,
            bindings: {
                find: async (account) => store.get(account),
                save: async (account, publicKey, displayName) => {
                    calls.saved.push(account);
                    store.set(account, { publicKey, displayName, refreshedAt: new Date(clock.t) });
                },
                refreshDisplayName: async (account, displayName) => {
                    calls.refreshed.push(account);
                    const current = store.get(account);
                    if (current) store.set(account, { ...current, displayName, refreshedAt: new Date(clock.t) });
                },
            },
            pinned: new Map([['ubichill@ubichill.com', { signingPublicKey: PINNED, displayName: 'Ubichill' }]]),
            fetchJson: async (url) => {
                calls.fetch.push(url);
                return options.remote ? options.remote(url) : undefined;
            },
            allowHttp: options.allowHttp ?? false,
            now: () => clock.t,
        });
        return { directory, calls, clock, store };
    };
    const remoteJrd =
        (key: string, name = 'アリス') =>
        () => ({
            subject: 'acct:alice@other.example',
            properties: { [SIGNING_KEY_WEBFINGER_PROPERTY]: key, [DISPLAY_NAME_WEBFINGER_PROPERTY]: name },
        });

    it('自サーバーのアカウントは DB で引き、ネットワークにも結び付けにも出ない', async () => {
        const { directory, calls } = setup();
        expect(await directory.resolve('youkan@ubichill.com', LOCAL)).toBe(LOCAL);
        expect(await directory.displayName('youkan@ubichill.com')).toBe('ようかん');
        expect(calls.fetch).toEqual([]);
        expect(calls.saved).toEqual([]);
    });

    it('リポジトリに記録した結び付け（公式）が最優先で、ネットワークに出ない', async () => {
        const { directory, calls } = setup();
        expect(await directory.resolve('ubichill@ubichill.com', PINNED)).toBe(PINNED);
        expect(await directory.displayName('ubichill@ubichill.com')).toBe('Ubichill');
        expect(calls.fetch).toEqual([]);
    });

    it('初回だけ WebFinger で確認して保存し、以後の同じ鍵は確認しない', async () => {
        const { directory, calls } = setup({ remote: remoteJrd(REMOTE) });
        expect(await directory.resolve('alice@other.example', REMOTE)).toBe(REMOTE);
        expect(await directory.resolve('alice@other.example', REMOTE)).toBe(REMOTE);
        expect(calls.fetch).toHaveLength(1);
        expect(calls.saved).toEqual(['alice@other.example']);
    });

    it('署名の鍵が確認済みの鍵と違えば確認し直し、新しい鍵を保存する（鍵の入れ替え）', async () => {
        const state = { key: REMOTE };
        const { directory, calls, store } = setup({ remote: () => remoteJrd(state.key)() });
        await directory.resolve('alice@other.example', REMOTE);
        state.key = ROTATED;
        expect(await directory.resolve('alice@other.example', ROTATED)).toBe(ROTATED);
        expect(calls.fetch).toHaveLength(2);
        expect(store.get('alice@other.example')?.publicKey).toBe(ROTATED);
    });

    it('他人の鍵で名乗られても、確認し直した結果と違えば一致しない（作者は付かない）', async () => {
        const { directory } = setup({ remote: remoteJrd(REMOTE) });
        expect(await directory.resolve('alice@other.example', 'F'.repeat(43))).toBe(REMOTE);
    });

    it('確認に失敗したら保存済みの鍵を返し、しばらく問い合わせ直さない', async () => {
        const state = { up: true };
        const { directory, calls, clock } = setup({ remote: () => (state.up ? remoteJrd(REMOTE)() : undefined) });
        await directory.resolve('alice@other.example', REMOTE);
        state.up = false;
        expect(await directory.resolve('alice@other.example', ROTATED)).toBe(REMOTE);
        expect(await directory.resolve('alice@other.example', ROTATED)).toBe(REMOTE);
        expect(calls.fetch).toHaveLength(2); // 失敗は 1 回だけ問い合わせる
        clock.t += 5 * 60 * 1000;
        await directory.resolve('alice@other.example', ROTATED);
        expect(calls.fetch).toHaveLength(3);
    });

    it('本番は https だけ、開発時だけ http も試す', async () => {
        const prod = setup();
        await prod.directory.resolve('alice@other.example', REMOTE);
        expect(prod.calls.fetch.map((u) => u.split(':')[0])).toEqual(['https']);
        const dev = setup({ allowHttp: true });
        await dev.directory.resolve('bob@other.example', REMOTE);
        expect(dev.calls.fetch.map((u) => u.split(':')[0])).toEqual(['https', 'http']);
    });

    it('表示名は確認済みの値で即答し、古くなったら裏で更新する。未確認のアカウントは出さない', async () => {
        const state = { name: 'アリス' };
        const { directory, calls, clock } = setup({ remote: () => remoteJrd(REMOTE, state.name)() });
        expect(await directory.displayName('alice@other.example')).toBeUndefined(); // 未確認
        expect(calls.fetch).toEqual([]);
        await directory.resolve('alice@other.example', REMOTE);
        state.name = 'アリス改';
        expect(await directory.displayName('alice@other.example')).toBe('アリス');
        expect(calls.refreshed).toEqual([]); // 新しいうちは更新しない
        clock.t += 60 * 60 * 1000 + 1;
        expect(await directory.displayName('alice@other.example')).toBe('アリス'); // 即答
        await new Promise((r) => setTimeout(r, 0));
        expect(await directory.displayName('alice@other.example')).toBe('アリス改');
    });

    it('形式不正なアカウントは問い合わせない', async () => {
        const { directory, calls } = setup();
        expect(await directory.resolve('not an account', REMOTE)).toBeUndefined();
        expect(calls.fetch).toEqual([]);
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
});
