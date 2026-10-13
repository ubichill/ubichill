import { acquireMod, generateSigningKeyPkcs8, importSigningKey, sriOf, webWorldCrypto } from '@ubichill/loader';
import {
    AUTHOR_KEYS_FRESH_MS,
    AUTHOR_KEYS_MAX_AGE_MS,
    type ModLockEntry,
    SIGNING_KEYS_WEBFINGER_REL,
    type SigningKeyEntry,
    signMod,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    availableStorage,
    createStoredAuthorBindings,
    type KeyValueStorage,
    MAX_STORED_AUTHORS,
} from './browserAuthorKeys';
import { createBrowserSignatureVerifier } from './modSignature';

/** localStorage の代わり（タブを閉じても残る保存領域）。 */
function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value);
        },
    };
}

describe('availableStorage', () => {
    it('localStorage を取り出すだけで例外になる環境では、メモリに切り替えて動く', async () => {
        const storage = availableStorage(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        });
        const store = createStoredAuthorBindings(storage);
        await store.bindings.save('alice@other.example', { keys: [{ publicKey: 'A'.repeat(43) }] });
        expect(await store.bindings.find('alice@other.example')).toBeDefined();
    });

    it('書き込みで例外になる（容量 0 など）・無い場合もメモリに切り替える', () => {
        const readOnly: KeyValueStorage = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException('quota', 'QuotaExceededError');
            },
        };
        for (const get of [() => readOnly, () => undefined]) {
            const storage = availableStorage(get);
            storage.setItem('k', 'v');
            expect(storage.getItem('k')).toBe('v');
        }
    });

    it('使える localStorage はそのまま使う', () => {
        const local = memoryStorage();
        expect(availableStorage(() => local)).toBe(local);
    });
});

describe('createStoredAuthorBindings', () => {
    const profile = { keys: [{ publicKey: 'A'.repeat(43) }], displayName: 'アリス' };

    it('保存した鍵一覧は、作り直しても（再読み込み）同じ確認時刻で読める', async () => {
        const storage = memoryStorage();
        await createStoredAuthorBindings(storage, () => 1_000).bindings.save('alice@other.example', profile);
        const found = await createStoredAuthorBindings(storage).bindings.find('alice@other.example');
        expect(found).toEqual({ ...profile, fetchedAt: new Date(1_000) });
    });

    it.each([
        'not json',
        '{}',
        '[["alice@other.example", {"keys": [{"publicKey": "short"}], "fetchedAt": 1}]]',
        '[["alice@other.example", {"keys": [], "fetchedAt": "1"}]]',
        '[["alice@other.example", {"keys": [], "fetchedAt": 1, "displayName": 3}]]',
        '[["alice@other.example"]]',
    ])('壊れた・書き換えられた保存値（%s）は無いものとして扱う', async (raw) => {
        const storage = memoryStorage();
        storage.setItem('ubichill:author-bindings:v1', raw);
        expect(await createStoredAuthorBindings(storage).bindings.find('alice@other.example')).toBeUndefined();
    });

    it('作者名を変えて大量に読ませても、保存する作者の数は上限まで（古いものから捨てる）', async () => {
        const storage = memoryStorage();
        const store = createStoredAuthorBindings(storage);
        for (const n of Array.from({ length: MAX_STORED_AUTHORS + 5 }, (_, i) => i)) {
            await store.bindings.save(`a${n}@other.example`, profile);
        }
        expect(await store.bindings.find('a0@other.example')).toBeUndefined();
        expect(await store.bindings.find(`a${MAX_STORED_AUTHORS + 4}@other.example`)).toBeDefined();
        const saved = JSON.parse(storage.getItem('ubichill:author-bindings:v1') ?? '[]') as unknown[];
        expect(saved).toHaveLength(MAX_STORED_AUTHORS);
    });

    it('保存できない（容量超過など）ときも確認自体は止めない', async () => {
        const full: KeyValueStorage = {
            getItem: () => null,
            setItem: () => {
                throw new Error('QuotaExceededError');
            },
        };
        const store = createStoredAuthorBindings(full);
        await expect(store.bindings.save('alice@other.example', profile)).resolves.toBeUndefined();
        await expect(store.confirmedContents.record('alice@other.example', 'h')).resolves.toBeUndefined();
    });
});

describe('ブラウザでの mod の作者署名の確認（SNS backend なし・本物の Ed25519）', () => {
    const AUTHOR = 'alice@other.example';
    const ORIGIN = 'https://other.example';
    const integrity = (c: string) => `sha256-${c.repeat(43)}=`;
    const entry: ModLockEntry = {
        id: 'pen',
        version: '1.0.0',
        manifestIntegrity: integrity('A'),
        components: { 'pen:pen': { workerUrl: './pen.js', integrity: integrity('B'), capabilities: [] } },
    };

    /** 作者のサーバー（WebFinger と鍵一覧）。`down` で止められる。 */
    function authorServer(keys: SigningKeyEntry[]) {
        const state = { keys, down: false, requests: [] as string[] };
        const fetchJson = async (url: string): Promise<unknown> => {
            state.requests.push(url);
            if (state.down) return undefined;
            if (url === `${ORIGIN}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${AUTHOR}`)}`) {
                return {
                    subject: `acct:${AUTHOR}`,
                    links: [{ rel: SIGNING_KEYS_WEBFINGER_REL, href: `${ORIGIN}/api/v1/authors/alice/signing-keys` }],
                };
            }
            if (url === `${ORIGIN}/api/v1/authors/alice/signing-keys`) {
                return { account: AUTHOR, issuedAt: new Date(0).toISOString(), keys: state.keys };
            }
            return undefined;
        };
        return { state, fetchJson };
    }

    async function setup() {
        const key = await importSigningKey(await generateSigningKeyPkcs8());
        const signature = await signMod(entry, key, webWorldCrypto, { author: AUTHOR });
        const server = authorServer([{ publicKey: key.publicKey }]);
        const storage = memoryStorage();
        const clock = { t: 1_000_000_000 };
        const verifier = () =>
            createBrowserSignatureVerifier({
                storage,
                fetchJson: server.fetchJson,
                allowHttp: false,
                now: () => clock.t,
            });
        return { key, signature, server, storage, clock, verifier };
    }

    it('作者のサーバーから鍵一覧を直接取って、作者として確かめる', async () => {
        const { signature, verifier, server } = await setup();
        expect(await verifier()(entry, signature)).toMatchObject({ status: 'verified', author: AUTHOR });
        expect(server.state.requests[0]).toMatch(/^https:\/\/other\.example\/\.well-known\/webfinger/);
    });

    it('再読み込みしても、鍵一覧が新しいうちは作者のサーバーへ問い合わせない', async () => {
        const { signature, verifier, server, clock } = await setup();
        await verifier()(entry, signature);
        const before = server.state.requests.length;
        clock.t += AUTHOR_KEYS_FRESH_MS - 1;
        expect(await verifier()(entry, signature)).toMatchObject({ status: 'verified' });
        expect(server.state.requests).toHaveLength(before);
    });

    it('作者のサーバーが止まっても、確認できていた mod は猶予（T_max）の間は動き、過ぎたら動かない', async () => {
        const { signature, verifier, server, clock } = await setup();
        await verifier()(entry, signature);
        server.state.down = true;
        clock.t += AUTHOR_KEYS_FRESH_MS + 1;
        expect(await verifier()(entry, signature)).toMatchObject({ status: 'verified' });
        clock.t += AUTHOR_KEYS_MAX_AGE_MS;
        expect(await verifier()(entry, signature)).toMatchObject({ status: 'rejected', reason: 'author-unconfirmed' });
    });

    it('作者が鍵を取り消すと、鍵一覧を取り直したあとの確認から通らない', async () => {
        const { key, signature, verifier, server, clock } = await setup();
        await verifier()(entry, signature);
        server.state.keys = [{ publicKey: key.publicKey, revokedAt: new Date(clock.t).toISOString() }];
        clock.t += AUTHOR_KEYS_FRESH_MS + 1;
        // 古い結果で即答しつつ裏で取り直す（backend と同じ規則）
        await verifier()(entry, signature);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(await verifier()(entry, signature)).toMatchObject({ status: 'rejected', reason: 'author-unconfirmed' });
    });

    it('一度も確認できていない作者は、作者のサーバーが止まっていれば動かない', async () => {
        const { signature, verifier, server } = await setup();
        server.state.down = true;
        expect(await verifier()(entry, signature)).toMatchObject({ status: 'rejected', reason: 'author-unconfirmed' });
    });

    it('Host の API に一度も問い合わせずに、署名付きの mod を読み込める（単体モード）', async () => {
        const { server } = await setup();
        const MODS = 'https://mods.example/mods';
        const manifest = JSON.stringify({
            id: 'pen',
            version: '1.0.0',
            components: { 'pen:pen': { workerUrl: './pen.js' } },
        });
        const worker = 'globalThis.onmessage = () => {};';
        const lockEntry = {
            ...entry,
            manifestIntegrity: await sriOf(new TextEncoder().encode(manifest).buffer),
            components: {
                'pen:pen': {
                    workerUrl: './pen.js',
                    integrity: await sriOf(new TextEncoder().encode(worker).buffer),
                    capabilities: [],
                },
            },
        };
        const key = await importSigningKey(await generateSigningKeyPkcs8());
        server.state.keys = [{ publicKey: key.publicKey }];
        const modSignature = await signMod(lockEntry, key, webWorldCrypto, { author: AUTHOR });
        const requested: string[] = [];
        const files: Record<string, { body: string; type: string }> = {
            [`${MODS}/pen/v1.0.0/manifest.json`]: { body: manifest, type: 'application/json' },
            [`${MODS}/pen/v1.0.0/pen.js`]: { body: worker, type: 'text/javascript' },
            [`${MODS}/pen/v1.0.0/lock.sig.json`]: { body: JSON.stringify(modSignature), type: 'application/json' },
        };
        const result = await acquireMod('pen:pen', {
            baseUrl: MODS,
            lock: { lockVersion: 1, mods: { pen: lockEntry } },
            verifySignature: createBrowserSignatureVerifier({
                storage: memoryStorage(),
                fetchJson: async (url) => {
                    requested.push(url);
                    return server.fetchJson(url);
                },
                allowHttp: false,
            }),
            allowUnsigned: () => false,
            fetchImpl: async (url: string) => {
                requested.push(url);
                const hit = files[url];
                return {
                    ok: !!hit,
                    headers: { get: () => hit?.type ?? null },
                    json: async () => JSON.parse(hit?.body ?? 'null'),
                    text: async () => hit?.body ?? '',
                    arrayBuffer: async () => new TextEncoder().encode(hit?.body ?? '').buffer,
                };
            },
        });
        expect(result).toMatchObject({ id: 'pen:pen', author: AUTHOR });
        // 問い合わせ先は mod の置き場所と作者のサーバーだけ
        expect(requested.every((url) => url.startsWith(`${MODS}/`) || url.startsWith(`${ORIGIN}/`))).toBe(true);
    });

    it('本番の Host は作者のサーバーに http で問い合わせない', async () => {
        const { signature, verifier, server } = await setup();
        await verifier()(entry, signature);
        expect(server.state.requests.every((url) => url.startsWith('https://'))).toBe(true);
    });
});
