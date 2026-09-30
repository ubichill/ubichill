import { DISPLAY_NAME_WEBFINGER_PROPERTY, SIGNING_KEYS_WEBFINGER_REL, type SigningKeyEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    AUTHOR_KEYS_FRESH_MS,
    AUTHOR_KEYS_MAX_AGE_MS,
    type AuthorProfile,
    createAuthorKeyDirectory,
    createFetchGuard,
    DOMAIN_FETCH_LIMIT,
    DOMAIN_FETCH_WINDOW_MS,
    webFingerLinks,
} from './authorKeys';

const ORIGIN = 'https://other.example';
const KEYS_URL = `${ORIGIN}/api/v1/authors/alice/signing-keys`;

const jrd = (subject: unknown, extra: Record<string, unknown> = {}) => ({
    subject,
    links: [{ rel: SIGNING_KEYS_WEBFINGER_REL, href: KEYS_URL }],
    ...extra,
});

describe('webFingerLinks', () => {
    it('問い合わせたアカウントの JRD から鍵一覧の URL と表示名を取り出す', () => {
        expect(
            webFingerLinks(
                jrd('acct:alice@Other.Example', { properties: { [DISPLAY_NAME_WEBFINGER_PROPERTY]: 'アリス' } }),
                'alice@other.example',
                ORIGIN,
            ),
        ).toEqual({ signingKeysUrl: KEYS_URL, displayName: 'アリス' });
    });

    it('別人の JRD（subject 不一致）は採用しない＝他人の鍵一覧をすり替えられない', () => {
        expect(webFingerLinks(jrd('acct:evil@other.example'), 'alice@other.example', ORIGIN)).toBeUndefined();
        expect(webFingerLinks(jrd('acct:alice@evil.example'), 'alice@other.example', ORIGIN)).toBeUndefined();
        expect(webFingerLinks(jrd(undefined), 'alice@other.example', ORIGIN)).toBeUndefined();
        expect(webFingerLinks('not json', 'alice@other.example', ORIGIN)).toBeUndefined();
    });

    it('鍵一覧の URL が別のオリジンを指していたら採用しない（鍵の決定を他サーバーに委ねさせない）', () => {
        const links = webFingerLinks(
            {
                subject: 'acct:alice@other.example',
                links: [{ rel: SIGNING_KEYS_WEBFINGER_REL, href: 'https://evil.example/keys' }],
            },
            'alice@other.example',
            ORIGIN,
        );
        expect(links).toEqual({});
    });

    it('相対 URL は WebFinger のオリジン基準で解決する', () => {
        const links = webFingerLinks(
            { subject: 'acct:alice@other.example', links: [{ rel: SIGNING_KEYS_WEBFINGER_REL, href: '/keys' }] },
            'alice@other.example',
            ORIGIN,
        );
        expect(links?.signingKeysUrl).toBe(`${ORIGIN}/keys`);
    });

    it('表示名が不正（制御文字・長すぎ・文字列でない）なら捨てる', () => {
        for (const bad of ['a\u0000b', 'x'.repeat(31), 42, '']) {
            const links = webFingerLinks(
                jrd('acct:alice@other.example', { properties: { [DISPLAY_NAME_WEBFINGER_PROPERTY]: bad } }),
                'alice@other.example',
                ORIGIN,
            );
            expect(links?.displayName).toBeUndefined();
        }
    });
});

describe('createAuthorKeyDirectory（公開環境の鍵一覧と取り消し）', () => {
    const LOCAL = 'B'.repeat(43);
    const LOCAL_REVOKED = 'b'.repeat(43);
    const REMOTE = 'C'.repeat(43);
    const REMOTE_NEW = 'D'.repeat(43);
    const PINNED = 'E'.repeat(43);
    const PINNED_REVOKED = 'e'.repeat(43);
    const OTHER = 'F'.repeat(43);
    const REVOKED_AT = '2026-09-01T00:00:00.000Z';

    const setup = (
        options: { allowHttp?: boolean; remote?: () => { keys: SigningKeyEntry[]; name?: string } | undefined } = {},
    ) => {
        const calls = { fetch: [] as string[], saved: [] as string[] };
        const clock = { t: 1_000_000_000 };
        const store = new Map<string, AuthorProfile & { fetchedAt: Date }>();
        const directory = createAuthorKeyDirectory({
            selfDomain: () => 'ubichill.com',
            findLocalAccount: async (handle) =>
                handle === 'youkan'
                    ? {
                          keys: [{ publicKey: LOCAL }, { publicKey: LOCAL_REVOKED, revokedAt: REVOKED_AT }],
                          displayName: 'ようかん',
                      }
                    : undefined,
            bindings: {
                find: async (account) => store.get(account),
                save: async (account, profile) => {
                    calls.saved.push(account);
                    store.set(account, { ...profile, fetchedAt: new Date(clock.t) });
                },
            },
            pinned: new Map([
                [
                    'ubichill@ubichill.com',
                    {
                        keys: [{ publicKey: PINNED }, { publicKey: PINNED_REVOKED, revokedAt: REVOKED_AT }],
                        displayName: 'Ubichill',
                    },
                ],
            ]),
            fetchJson: async (url) => {
                calls.fetch.push(url);
                const remote = options.remote?.();
                if (!remote) return undefined;
                if (url.includes('/.well-known/webfinger')) {
                    return {
                        subject: 'acct:alice@other.example',
                        properties: { [DISPLAY_NAME_WEBFINGER_PROPERTY]: remote.name ?? 'アリス' },
                        links: [{ rel: SIGNING_KEYS_WEBFINGER_REL, href: `${new URL(url).origin}/keys` }],
                    };
                }
                return { account: 'alice@other.example', issuedAt: new Date(clock.t).toISOString(), keys: remote.keys };
            },
            allowHttp: options.allowHttp ?? false,
            now: () => clock.t,
        });
        return { directory, calls, clock, store };
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));

    it('自サーバーのアカウントは DB の公開環境で判定し、取り消した鍵は作者にしない', async () => {
        const { directory, calls } = setup();
        expect(await directory.isAuthorKey('youkan@ubichill.com', LOCAL)).toBe(true);
        expect(await directory.isAuthorKey('youkan@ubichill.com', LOCAL_REVOKED)).toBe(false);
        expect(await directory.isAuthorKey('youkan@ubichill.com', OTHER)).toBe(false);
        expect(await directory.displayName('youkan@ubichill.com')).toBe('ようかん');
        expect(calls.fetch).toEqual([]);
    });

    it('レビュー済みの記録（公式）が最優先で、記録で取り消した鍵は作者にしない', async () => {
        const { directory, calls } = setup();
        expect(await directory.isAuthorKey('ubichill@ubichill.com', PINNED)).toBe(true);
        expect(await directory.isAuthorKey('ubichill@ubichill.com', PINNED_REVOKED)).toBe(false);
        expect(await directory.displayName('ubichill@ubichill.com')).toBe('Ubichill');
        expect(calls.fetch).toEqual([]);
    });

    it('他サーバーは WebFinger → 鍵一覧を辿って保存し、新しいうちはネットワークに出ない', async () => {
        const { directory, calls } = setup({ remote: () => ({ keys: [{ publicKey: REMOTE }] }) });
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(true);
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(true);
        expect(calls.fetch).toEqual([
            'https://other.example/.well-known/webfinger?resource=acct%3Aalice%40other.example',
            'https://other.example/keys',
        ]);
        expect(calls.saved).toEqual(['alice@other.example']);
    });

    it('知らない鍵（新しい公開環境）なら待って取り直す', async () => {
        const state = { keys: [{ publicKey: REMOTE }] as SigningKeyEntry[] };
        const { directory, calls, clock } = setup({ remote: () => ({ keys: state.keys }) });
        await directory.isAuthorKey('alice@other.example', REMOTE);
        state.keys = [{ publicKey: REMOTE }, { publicKey: REMOTE_NEW }];
        clock.t += 60 * 1000;
        expect(await directory.isAuthorKey('alice@other.example', REMOTE_NEW)).toBe(true);
        expect(calls.fetch).toHaveLength(4);
    });

    it('他人の鍵で名乗られても、鍵一覧に無ければ作者は付かない', async () => {
        const { directory, calls, clock } = setup({ remote: () => ({ keys: [{ publicKey: REMOTE }] }) });
        await directory.isAuthorKey('alice@other.example', REMOTE);
        clock.t += 60 * 1000;
        expect(await directory.isAuthorKey('alice@other.example', OTHER)).toBe(false);
        expect(calls.fetch).toHaveLength(4);
    });

    it('毎回違う知らない鍵で名乗られても、作者のサーバーへの問い合わせは最短間隔ごとに 1 回（増幅させない）', async () => {
        const { directory, calls, clock } = setup({ remote: () => ({ keys: [{ publicKey: REMOTE }] }) });
        await directory.isAuthorKey('alice@other.example', REMOTE);
        for (const c of 'GHIJKLMNOP') {
            expect(await directory.isAuthorKey('alice@other.example', c.repeat(43))).toBe(false);
        }
        expect(calls.fetch).toHaveLength(2);
        clock.t += 60 * 1000;
        await directory.isAuthorKey('alice@other.example', 'Q'.repeat(43));
        await directory.isAuthorKey('alice@other.example', 'R'.repeat(43));
        expect(calls.fetch).toHaveLength(4);
    });

    it('T_fresh を超えたら保存した結果で即答し、裏で取り直した取り消しを次から反映する', async () => {
        const state = { keys: [{ publicKey: REMOTE }] as SigningKeyEntry[] };
        const { directory, clock } = setup({ remote: () => ({ keys: state.keys }) });
        await directory.isAuthorKey('alice@other.example', REMOTE);
        state.keys = [{ publicKey: REMOTE, revokedAt: REVOKED_AT }];
        clock.t += AUTHOR_KEYS_FRESH_MS - 1;
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(true); // 新しいうちは取り直さない
        clock.t += 2;
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(true); // 即答
        await tick();
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(false);
    });

    it('取り消した鍵は、知らない鍵と違って取り直しを待たずに作者を外す', async () => {
        const { directory, calls } = setup({
            remote: () => ({ keys: [{ publicKey: REMOTE, revokedAt: REVOKED_AT }] }),
        });
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(false);
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(false);
        expect(calls.fetch).toHaveLength(2);
    });

    it('相手が落ちていても T_max までは保存した結果を使い、超えたら作者を外す', async () => {
        const state = { up: true };
        const { directory, clock } = setup({
            remote: () => (state.up ? { keys: [{ publicKey: REMOTE }] } : undefined),
        });
        await directory.isAuthorKey('alice@other.example', REMOTE);
        state.up = false;
        clock.t += AUTHOR_KEYS_MAX_AGE_MS;
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(true);
        expect(await directory.displayName('alice@other.example')).toBe('アリス');
        clock.t += 1;
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(false);
        expect(await directory.displayName('alice@other.example')).toBeUndefined();
        state.up = true;
        clock.t += 5 * 60 * 1000;
        expect(await directory.isAuthorKey('alice@other.example', REMOTE)).toBe(true); // 復旧したら戻る
    });

    it('同じアカウントへの同時の取り直しは 1 回にまとめる', async () => {
        const { directory, calls } = setup({ remote: () => ({ keys: [{ publicKey: REMOTE }] }) });
        await Promise.all([
            directory.isAuthorKey('alice@other.example', REMOTE),
            directory.isAuthorKey('alice@other.example', REMOTE),
            directory.displayName('alice@other.example'),
        ]);
        expect(calls.fetch).toHaveLength(2);
    });

    it('鍵一覧が別のアカウントのものなら採用しない', async () => {
        const { directory } = setup({ remote: () => ({ keys: [{ publicKey: REMOTE }] }) });
        expect(await directory.isAuthorKey('bob@other.example', REMOTE)).toBe(false);
    });

    it('本番は https だけ、開発時だけ http も試す', async () => {
        const prod = setup();
        await prod.directory.isAuthorKey('alice@other.example', REMOTE);
        expect(prod.calls.fetch.map((u) => u.split(':')[0])).toEqual(['https']);
        const dev = setup({ allowHttp: true });
        await dev.directory.isAuthorKey('bob@other.example', REMOTE);
        expect(dev.calls.fetch.map((u) => u.split(':')[0])).toEqual(['https', 'http']);
    });

    it('形式不正なアカウントは問い合わせない', async () => {
        const { directory, calls } = setup();
        expect(await directory.isAuthorKey('not an account', REMOTE)).toBe(false);
        expect(calls.fetch).toEqual([]);
    });
});

describe('createFetchGuard（ドメイン単位の取得回数の上限）', () => {
    it('窓の間は上限まで取得でき、超えたら拒否し、窓が過ぎたら再び取得できる。ドメインごとに別に数える', () => {
        const clock = { t: 0 };
        const guard = createFetchGuard({ limit: 3, windowMs: 1000, now: () => clock.t });
        expect([1, 2, 3, 4].map(() => guard.tryAcquire('victim.example'))).toEqual([true, true, true, false]);
        expect(guard.tryAcquire('other.example')).toBe(true);
        clock.t = 1000;
        expect(guard.tryAcquire('victim.example')).toBe(true);
    });

    it('ドメイン数の記録にも上限がある（古いドメインの記録から捨てる）', () => {
        const guard = createFetchGuard({ limit: 1, windowMs: 60_000, now: () => 0, maxDomains: 2 });
        guard.tryAcquire('a.example');
        guard.tryAcquire('b.example');
        guard.tryAcquire('c.example');
        expect(guard.tryAcquire('a.example')).toBe(true); // a の記録は捨てられている
    });
});

describe('作者名を変えて問い合わせを出させる攻撃', () => {
    it('同じドメインの作者名を変え続けても、そのドメインへの取得は窓ごとに上限までで、超えた分は作者を付けない', async () => {
        const fetched: string[] = [];
        const clock = { t: 1_000_000_000 };
        const directory = createAuthorKeyDirectory({
            selfDomain: () => 'ubichill.com',
            findLocalAccount: async () => undefined,
            bindings: { find: async () => undefined, save: async () => undefined },
            pinned: new Map(),
            fetchJson: async (url) => {
                fetched.push(url);
                return undefined;
            },
            allowHttp: false,
            now: () => clock.t,
        });
        const key = 'K'.repeat(43);
        for (let i = 0; i < DOMAIN_FETCH_LIMIT + 50; i++) {
            expect(await directory.isAuthorKey(`a${i}_user@victim.example`, key)).toBe(false);
        }
        expect(fetched).toHaveLength(DOMAIN_FETCH_LIMIT);
        clock.t += DOMAIN_FETCH_WINDOW_MS;
        await directory.isAuthorKey('later_user@victim.example', key);
        expect(fetched).toHaveLength(DOMAIN_FETCH_LIMIT + 1);
    });
});
