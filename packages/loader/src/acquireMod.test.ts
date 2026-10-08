import { createHash } from 'node:crypto';
import type { ModLock } from '@ubichill/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { acquireMod, assetIntegrityOf, resetAcquireCaches } from './acquireMod';
import type { FetchLike, FetchLikeResponse } from './types';

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
function fakeFetch(routes: Record<string, { body: string; contentType?: string; ok?: boolean }>): FetchLike {
    return async (input): Promise<FetchLikeResponse> => {
        const hit = routes[input];
        const body = hit?.body ?? '';
        return {
            ok: hit ? (hit.ok ?? true) : false,
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

beforeEach(() => resetAcquireCaches());

describe('acquireMod', () => {
    it('正規バイト列 → verified、capabilities は lock 天井', async () => {
        const r = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
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
        const r = await acquireMod(TYPE, { baseUrl: BASE, fetchImpl: spy });
        expect(r).toEqual({ rejected: 'lock-missing' });
        expect(called).toBe(false); // ネットワークに触れない
    });

    it('本体のワールドでも外部と同じく、lock と違うコードは拒否し、lock に無い mod は fetch せず拒否する', async () => {
        const swapped = await acquireMod(TYPE, {
            baseUrl: BASE,
            lock: lock(),
            fetchImpl: fakeFetch(goodRoutes(`${WORKER_CODE} /* swapped */`)),
        });
        expect(swapped).toEqual({ rejected: 'integrity-mismatch' });
        let called = false;
        const spy: FetchLike = async (input) => {
            called = true;
            return fakeFetch(goodRoutes())(input);
        };
        expect(await acquireMod(TYPE, { baseUrl: BASE, fetchImpl: spy })).toEqual({ rejected: 'lock-missing' });
        expect(called).toBe(false);
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
            fetchImpl: fakeFetch(goodRoutes()),
        });
        expect(r).toEqual({ rejected: 'lock-missing' });
    });

    it('コロンを含まない entityType は not-found', async () => {
        const r = await acquireMod('nocolon', { baseUrl: BASE, fetchImpl: fakeFetch({}) });
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
            fetchImpl: fakeFetch(routes),
        });
        expect(r).toEqual({ rejected: 'manifest-mismatch' });
    });

    it('アセットの無い mod は assetIntegrity を持たない', async () => {
        const r = await acquireMod(TYPE, { baseUrl: BASE, lock: lock(), fetchImpl: fakeFetch(goodRoutes()) });
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
