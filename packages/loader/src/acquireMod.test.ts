import { createHash } from 'node:crypto';
import { type AuthorKeyCheck, type ModLock, signMod, verifyModSignature } from '@ubichill/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    type AcquireModOptions,
    acquireMod,
    assetIntegrityOf,
    MOD_AUTHOR_CACHE_TTL_MS,
    resetAcquireCaches,
} from './acquireMod';
import type { FetchLike, FetchLikeResponse } from './types';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from './worldCrypto';

const BASE = 'https://cdn.test/mods';
const MOD = 'pen';
const VER = '2.0.0';
const TYPE = 'pen:canvas';
const WORKER_CODE = 'globalThis.onmessage = () => {};';
const WORKER_URL = './canvas/index.abc.js';

/** build-workers と同一規約の SRI（テストで lock/期待値を作る用）。 */
function sri(text: string): string {
    return `sha256-${createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('base64')}`;
}

const manifestJson = JSON.stringify({
    id: MOD,
    name: 'Pen',
    version: VER,
    components: { [TYPE]: { workerUrl: WORKER_URL, capabilities: ['scene:read'] } },
});

/** URL→レスポンス本体をひく最小 fetch フェイク。 */
function fakeFetch(
    routes: Record<string, { body: string; contentType?: string; ok?: boolean; status?: number }>,
): FetchLike {
    return async (input): Promise<FetchLikeResponse> => {
        const hit = routes[input];
        const body = hit?.body ?? '';
        return {
            ok: hit ? (hit.ok ?? true) : false,
            status: hit ? (hit.status ?? (hit.ok === false ? 503 : 200)) : 404,
            headers: { get: (n) => (n.toLowerCase() === 'content-type' ? (hit?.contentType ?? '') : null) },
            json: async () => JSON.parse(body),
            text: async () => body,
            arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        };
    };
}

const workerUrlAbs = `${BASE}/${MOD}/v${VER}/canvas/index.abc.js`;
const manifestUrlAbs = `${BASE}/${MOD}/v${VER}/manifest.json`;

/** 正規ルート（manifest + worker）。worker の content-type は javascript。 */
function goodRoutes(workerCode = WORKER_CODE) {
    return {
        [manifestUrlAbs]: { body: manifestJson },
        [workerUrlAbs]: { body: workerCode, contentType: 'text/javascript' },
    };
}

/** lock（capability 天井 = scene:read のみ。manifest と同じ hash）。 */
function lock(workerCode = WORKER_CODE): ModLock {
    return {
        lockVersion: 1,
        mods: {
            [MOD]: {
                id: MOD,
                version: VER,
                manifestIntegrity: sri(manifestJson),
                components: {
                    [TYPE]: { workerUrl: WORKER_URL, integrity: sri(workerCode), capabilities: ['scene:read'] },
                },
            },
        },
    };
}

/** 署名ファイルを置かない既存のテスト用: 開発用の Host として「署名なし（開発）」を許す。 */
const unsignedDev: Pick<AcquireModOptions, 'verifySignature' | 'allowUnsigned'> = {
    verifySignature: async () => ({ status: 'rejected', reason: 'author-unconfirmed' }),
    allowUnsigned: () => true,
};

beforeEach(() => resetAcquireCaches());

describe('acquireMod', () => {
    it('正規バイト列 → verified、capabilities は lock 天井', async () => {
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            ...unsignedDev,
            fetchImpl: fakeFetch(goodRoutes()),
        });
        expect(typeof r === 'object' && 'workerCode' in r).toBe(true);
        if (typeof r === 'object' && 'workerCode' in r) {
            expect(r.workerCode).toBe(WORKER_CODE);
            expect(r.capabilities).toEqual(['scene:read']);
            expect(r.modBase).toBe(`${BASE}/${MOD}/v${VER}`);
        }
    });

    it('worker が差し替えられている（hash 不一致）→ integrity-mismatch で拒否', async () => {
        const tampered = `${WORKER_CODE} /* injected */`;
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(), // lock は元コードの hash
            ...unsignedDev,
            fetchImpl: fakeFetch(goodRoutes(tampered)), // 配信は改竄コード
        });
        expect(r).toEqual({ rejected: 'integrity-mismatch' });
    });

    it('lock 記載が無い → fetch せず lock-missing 拒否', async () => {
        let called = false;
        const spy: FetchLike = async (input) => {
            called = true;
            return fakeFetch(goodRoutes())(input);
        };
        const r = await acquireMod(TYPE, { baseUrl: BASE, ...unsignedDev, fetchImpl: spy });
        expect(r).toEqual({ rejected: 'lock-missing' });
        expect(called).toBe(false); // ネットワークに触れない
    });

    it('本体のワールドでも外部と同じく、lock と違うコードは拒否し、lock に無い mod は fetch せず拒否する', async () => {
        const swapped = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            ...unsignedDev,
            fetchImpl: fakeFetch(goodRoutes(`${WORKER_CODE} /* swapped */`)),
        });
        expect(swapped).toEqual({ rejected: 'integrity-mismatch' });
        let called = false;
        const spy: FetchLike = async (input) => {
            called = true;
            return fakeFetch(goodRoutes())(input);
        };
        expect(await acquireMod(TYPE, { baseUrl: BASE, ...unsignedDev, fetchImpl: spy })).toEqual({
            rejected: 'lock-missing',
        });
        expect(called).toBe(false);
    });

    it('manifest の一時的な取得失敗は記憶せず、通信復旧後の再試行で読み込める', async () => {
        const requests: string[] = [];
        const good = fakeFetch(goodRoutes());
        const failing = fakeFetch({ [manifestUrlAbs]: { body: '', ok: false, status: 503 } });
        const fetchImpl: FetchLike = (url, init) => {
            if (url === manifestUrlAbs) requests.push(url);
            return url === manifestUrlAbs && requests.length === 1 ? failing(url, init) : good(url, init);
        };
        const options = { baseUrl: BASE, lock: lock(), ...unsignedDev, fetchImpl };
        expect(await acquireMod(TYPE, options)).toBe('not-found');
        expect(await acquireMod(TYPE, options)).toMatchObject({ id: TYPE, workerCode: WORKER_CODE });
        expect(requests).toHaveLength(2);
    });

    it('workerUrl の無い Component は data-only', async () => {
        const dataOnlyManifest = JSON.stringify({
            id: MOD,
            version: VER,
            components: { [TYPE]: { capabilities: [] } },
        });
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: {
                lockVersion: 1,
                mods: { [MOD]: { id: MOD, version: VER, manifestIntegrity: sri(dataOnlyManifest), components: {} } },
            },
            ...unsignedDev,
            fetchImpl: fakeFetch({ [manifestUrlAbs]: { body: dataOnlyManifest } }),
        });
        expect(r).toBe('data-only');
    });

    it('lockEntry はあるが対象 component が lock に無い → lock-missing 拒否', async () => {
        // mod（pen）の lock はあるが components が空＝この entity の hash が固定されていない。
        // manifest には entity が存在するので取得は進むが、lock 未記載として拒否されるべき。
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: {
                lockVersion: 1,
                mods: { [MOD]: { id: MOD, version: VER, manifestIntegrity: sri(manifestJson), components: {} } },
            },
            ...unsignedDev,
            fetchImpl: fakeFetch(goodRoutes()),
        });
        expect(r).toEqual({ rejected: 'lock-missing' });
    });

    it('コロンを含まない entityType は not-found', async () => {
        const r = await acquireMod('nocolon', { baseUrl: BASE, ...unsignedDev, fetchImpl: fakeFetch({}) });
        expect(r).toBe('not-found');
    });

    it('lock.baseUrl がある mod は既定の baseUrl ではなくそちらから取得する', async () => {
        const OTHER = 'https://other-host.test/mods';
        const otherWorkerUrlAbs = `${OTHER}/${MOD}/v${VER}/canvas/index.abc.js`;
        const otherManifestUrlAbs = `${OTHER}/${MOD}/v${VER}/manifest.json`;

        const lockWithBaseUrl: ModLock = { ...lock(), mods: { [MOD]: { ...lock().mods[MOD], baseUrl: OTHER } } };

        const r = await acquireMod(TYPE, {
            baseUrl: BASE, // これは使われないはず
            lock: lockWithBaseUrl,
            ...unsignedDev,
            fetchImpl: fakeFetch({
                [otherManifestUrlAbs]: { body: manifestJson },
                [otherWorkerUrlAbs]: { body: WORKER_CODE, contentType: 'text/javascript' },
            }),
        });
        expect(typeof r === 'object' && 'workerCode' in r).toBe(true);
        if (typeof r === 'object' && 'workerCode' in r) {
            expect(r.modBase).toBe(`${OTHER}/${MOD}/v${VER}`);
        }
    });
});

describe('同梱アセットの integrity', () => {
    const wasmSri = `sha256-${'A'.repeat(43)}=`;
    const withAssets = JSON.stringify({
        id: MOD,
        version: VER,
        components: { [TYPE]: { workerUrl: WORKER_URL, capabilities: ['asset:read'] } },
        assets: ['fnv1a.wasm'],
        assetIntegrity: { 'fnv1a.wasm': wasmSri },
    });

    it('lock と照合済みの manifest から assetIntegrity を Host へ渡す', async () => {
        const routes = { ...goodRoutes(), [manifestUrlAbs]: { body: withAssets } };
        const base = lock();
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: { ...base, mods: { [MOD]: { ...base.mods[MOD], manifestIntegrity: sri(withAssets) } } },
            ...unsignedDev,
            fetchImpl: fakeFetch(routes),
        });
        expect(r).toMatchObject({ assetIntegrity: { 'fnv1a.wasm': wasmSri } });
    });

    it('manifest の assetIntegrity を後から書き換えると、manifest ごと拒否される', async () => {
        const tampered = withAssets.replace(wasmSri, `sha256-${'B'.repeat(43)}=`);
        const routes = { ...goodRoutes(), [manifestUrlAbs]: { body: tampered } };
        const base = lock();
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: { ...base, mods: { [MOD]: { ...base.mods[MOD], manifestIntegrity: sri(withAssets) } } },
            ...unsignedDev,
            fetchImpl: fakeFetch(routes),
        });
        expect(r).toEqual({ rejected: 'manifest-mismatch' });
    });

    it('アセットの無い mod は assetIntegrity を持たない', async () => {
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            ...unsignedDev,
            fetchImpl: fakeFetch(goodRoutes()),
        });
        expect(r).toMatchObject({ assetIntegrity: undefined });
    });

    it('assetIntegrityOf は文字列以外の値・配列・null を捨て、凍結して返す', () => {
        expect(assetIntegrityOf({ 'a.wasm': 'sha256-x', 'b.bin': 1, 'c.bin': null })).toEqual({ 'a.wasm': 'sha256-x' });
        expect(Object.isFrozen(assetIntegrityOf({}))).toBe(true);
        expect(assetIntegrityOf(['a'])).toBeUndefined();
        expect(assetIntegrityOf(null)).toBeUndefined();
        expect(assetIntegrityOf('x')).toBeUndefined();
    });
});

describe('作者署名', () => {
    const AUTHOR = 'alice@example.com';
    const sigUrlAbs = `${BASE}/${MOD}/v${VER}/lock.sig.json`;
    const newKey = async () => importSigningKey(await generateSigningKeyPkcs8());

    /** 本物の ed25519 で検証し、作者の鍵一覧は `keys` を正とする Host。 */
    const hostTrusting = (keys: Record<string, string>, calls: string[] = []): AcquireModOptions['verifySignature'] => {
        const isAuthorKey: AuthorKeyCheck = async (author, publicKey) => {
            calls.push(author);
            return keys[author] === publicKey ? { status: 'confirmed' } : { status: 'unconfirmed' };
        };
        return (entry, signature) => verifyModSignature(entry, signature, webWorldCrypto, isAuthorKey);
    };

    const signedRoutes = async (
        key: Awaited<ReturnType<typeof newKey>>,
        author = AUTHOR,
        workerCode = WORKER_CODE,
    ) => ({
        ...goodRoutes(workerCode),
        [sigUrlAbs]: {
            body: JSON.stringify(await signMod(lock().mods[MOD], key, webWorldCrypto, { author })),
            contentType: 'application/json',
        },
    });

    it('作者の鍵で署名された mod は、作者付きで読み込める', async () => {
        const key = await newKey();
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({ [AUTHOR]: key.publicKey }),
            fetchImpl: fakeFetch(await signedRoutes(key)),
        });
        expect(r).toMatchObject({ id: TYPE, author: AUTHOR });
    });

    it('署名ファイルが無い mod は実行しない（lock と一致していても）', async () => {
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({}),
            fetchImpl: fakeFetch(goodRoutes()),
        });
        expect(r).toEqual({ rejected: 'signature-missing' });
    });

    it('SPA の fallback（200 の HTML）が返っても、署名ありとは扱わない', async () => {
        const routes = {
            ...goodRoutes(),
            [sigUrlAbs]: { body: '<!doctype html><html></html>', contentType: 'text/html' },
        };
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({}),
            fetchImpl: fakeFetch(routes),
        });
        expect(r).toEqual({ rejected: 'signature-missing' });
    });

    it.each([429, 503])('署名の取得が HTTP %i なら、未署名と決めつけず再試行できる', async (status) => {
        const routes = { ...goodRoutes(), [sigUrlAbs]: { body: '', ok: false, status } };
        expect(
            await acquireMod(TYPE, { baseUrl: BASE, lock: lock(), ...unsignedDev, fetchImpl: fakeFetch(routes) }),
        ).toEqual({ rejected: 'author-pending' });
    });

    it('署名ファイルへの通信失敗も、開発用の未署名例外にしない', async () => {
        const fallback = fakeFetch(goodRoutes());
        const fetchImpl: FetchLike = (url, init) =>
            url === sigUrlAbs ? Promise.reject(Error('offline')) : fallback(url, init);
        expect(await acquireMod(TYPE, { baseUrl: BASE, lock: lock(), ...unsignedDev, fetchImpl })).toEqual({
            rejected: 'author-pending',
        });
    });

    it('開発用の Host は、許した取得元の未署名 mod だけを作者なしで動かす', async () => {
        const seen: string[] = [];
        const options = {
            lock: lock(),
            verifySignature: hostTrusting({}),
            allowUnsigned: (baseUrl: string) => {
                seen.push(baseUrl);
                return baseUrl === BASE;
            },
        };
        const local = await acquireMod(TYPE, { ...options, baseUrl: BASE, fetchImpl: fakeFetch(goodRoutes()) });
        expect(local).toMatchObject({ id: TYPE });
        expect(local).not.toHaveProperty('author', expect.anything());

        resetAcquireCaches();
        const OTHER = 'https://other-host.test/mods';
        const external = await acquireMod(TYPE, {
            ...options,
            baseUrl: BASE,
            lock: { ...lock(), mods: { [MOD]: { ...lock().mods[MOD], baseUrl: OTHER } } },
            fetchImpl: fakeFetch({
                [`${OTHER}/${MOD}/v${VER}/manifest.json`]: { body: manifestJson },
                [`${OTHER}/${MOD}/v${VER}/canvas/index.abc.js`]: { body: WORKER_CODE, contentType: 'text/javascript' },
            }),
        });
        expect(external).toEqual({ rejected: 'signature-missing' });
        expect(seen).toEqual([BASE, OTHER]);
    });

    it('開発用の Host でも、署名ファイルがあるのに確認できない mod は実行しない', async () => {
        const mallory = await newKey();
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({ [AUTHOR]: (await newKey()).publicKey }),
            allowUnsigned: () => true,
            fetchImpl: fakeFetch(await signedRoutes(mallory)),
        });
        expect(r).toEqual({ rejected: 'author-unconfirmed' });
    });

    it('別の内容に付けた署名を置いても通らない（ワールドが固定した lock と照合する）', async () => {
        const key = await newKey();
        const other = { ...lock().mods[MOD], manifestIntegrity: sri('another manifest') };
        const routes = {
            ...goodRoutes(),
            [sigUrlAbs]: { body: JSON.stringify(await signMod(other, key, webWorldCrypto, { author: AUTHOR })) },
        };
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({ [AUTHOR]: key.publicKey }),
            fetchImpl: fakeFetch(routes),
        });
        expect(r).toEqual({ rejected: 'signature-content-mismatch' });
    });

    it('lock と違うコードは、正しい署名があっても lock の照合で拒否する', async () => {
        const key = await newKey();
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({ [AUTHOR]: key.publicKey }),
            fetchImpl: fakeFetch(await signedRoutes(key, AUTHOR, `${WORKER_CODE} /* swapped */`)),
        });
        expect(r).toEqual({ rejected: 'integrity-mismatch' });
    });

    it('確認の途中で落ちたら「いまは確認できない」として拒否し、次の読み込みで確認し直す', async () => {
        const key = await newKey();
        const routes = await signedRoutes(key);
        const state = { down: true };
        const trusting = hostTrusting({ [AUTHOR]: key.publicKey });
        const options = {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: ((entry, signature) =>
                state.down
                    ? Promise.reject(new Error('backend down'))
                    : trusting(entry, signature)) satisfies AcquireModOptions['verifySignature'],
            fetchImpl: fakeFetch(routes),
        };
        expect(await acquireMod(TYPE, options)).toEqual({ rejected: 'author-pending' });
        state.down = false;
        expect(await acquireMod(TYPE, options)).toMatchObject({ author: AUTHOR });
    });

    it('鍵を取り消したら、期限を過ぎた読み込みからは実行しない（確認済みの結果を使い続けない）', async () => {
        const key = await newKey();
        const keys: Record<string, string> = { [AUTHOR]: key.publicKey };
        const calls: string[] = [];
        const clock = { now: 1_000_000 };
        const options = {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting(keys, calls),
            fetchImpl: fakeFetch(await signedRoutes(key)),
            now: () => clock.now,
        };
        expect(await acquireMod(TYPE, options)).toMatchObject({ author: AUTHOR });

        // 作者が公開環境を取り消す
        delete keys[AUTHOR];
        clock.now += MOD_AUTHOR_CACHE_TTL_MS - 1;
        expect(await acquireMod(TYPE, options)).toMatchObject({ author: AUTHOR });
        expect(calls).toHaveLength(1);

        clock.now += 1;
        expect(await acquireMod(TYPE, options)).toEqual({ rejected: 'author-unconfirmed' });
        expect(calls).toHaveLength(2);
    });

    it('期限を過ぎても有効な鍵なら、確認し直してそのまま実行できる', async () => {
        const key = await newKey();
        const calls: string[] = [];
        const clock = { now: 0 };
        const options = {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({ [AUTHOR]: key.publicKey }, calls),
            fetchImpl: fakeFetch(await signedRoutes(key)),
            now: () => clock.now,
        };
        await acquireMod(TYPE, options);
        clock.now += MOD_AUTHOR_CACHE_TTL_MS;
        expect(await acquireMod(TYPE, options)).toMatchObject({ author: AUTHOR });
        expect(calls).toHaveLength(2);
    });

    it('同じ mod の作者の確認は 1 回で済ませる', async () => {
        const key = await newKey();
        const calls: string[] = [];
        const options = {
            baseUrl: BASE,
            lock: lock(),
            verifySignature: hostTrusting({ [AUTHOR]: key.publicKey }, calls),
            fetchImpl: fakeFetch(await signedRoutes(key)),
        };
        await Promise.all([acquireMod(TYPE, options), acquireMod(TYPE, options)]);
        await acquireMod(TYPE, options);
        expect(calls).toEqual([AUTHOR]);
    });
});
