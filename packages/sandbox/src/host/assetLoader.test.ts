import { createHash } from 'node:crypto';
import { UbiErrorCode } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { isValidAssetPath, loadModAsset, matchesIntegrity } from './assetLoader';

const MOD_BASE = 'https://cdn.example.com/mods/demo/v1.0.0';
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function sri(bytes: Uint8Array, algorithm: 'sha256' | 'sha384' = 'sha256'): string {
    return `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;
}

function serve(files: Record<string, Uint8Array<ArrayBuffer> | number>) {
    return vi.fn(async (url: string | URL | Request) => {
        const body = files[String(url)];
        if (body === undefined) return new Response('not found', { status: 404 });
        if (typeof body === 'number') return new Response(null, { status: body });
        return new Response(body, { status: 200 });
    });
}

describe('isValidAssetPath', () => {
    it.each(['a.wasm', 'lib/python.zip', 'deep/er/x.bin', 'with space.txt'])('受け付ける: %s', (path) => {
        expect(isValidAssetPath(path)).toBe(true);
    });

    it.each([
        '',
        '/abs.wasm',
        '../secret',
        'a/../../b',
        'a//b',
        'a/./b',
        'a\\b',
        'x.wasm?v=1',
        'x.wasm#frag',
        'https://evil.example.com/x.wasm',
        'C:/x',
        '%2e%2e/manifest.json',
        'a/',
    ])('拒否する: %s', (path) => {
        expect(isValidAssetPath(path)).toBe(false);
    });
});

describe('matchesIntegrity', () => {
    it('sha256 / sha384 の SRI と一致を判定する', async () => {
        expect(await matchesIntegrity(WASM.slice().buffer, sri(WASM))).toBe(true);
        expect(await matchesIntegrity(WASM.slice().buffer, sri(WASM, 'sha384'))).toBe(true);
        expect(await matchesIntegrity(new Uint8Array([1]).buffer, sri(WASM))).toBe(false);
    });

    it('未知のアルゴリズム・壊れた SRI は不一致として扱う', async () => {
        expect(await matchesIntegrity(WASM.slice().buffer, 'md5-abc')).toBe(false);
        expect(await matchesIntegrity(WASM.slice().buffer, 'sha256')).toBe(false);
        expect(await matchesIntegrity(WASM.slice().buffer, '-abc')).toBe(false);
    });
});

describe('loadModAsset', () => {
    const integrity = { 'a.wasm': sri(WASM), 'nested/b.bin': sri(new Uint8Array([9])) };

    it('integrity と一致したバイト列を返す（先頭の ./ は manifest のキーに合わせて外す）', async () => {
        const fetchImpl = serve({ [`${MOD_BASE}/a.wasm`]: WASM });
        const bytes = await loadModAsset('./a.wasm', { modBase: MOD_BASE, integrity }, { fetchImpl });
        expect(new Uint8Array(bytes)).toEqual(WASM);
        expect(fetchImpl).toHaveBeenCalledWith(
            `${MOD_BASE}/a.wasm`,
            expect.objectContaining({ credentials: 'same-origin' }),
        );
    });

    it('配布元が中身を差し替えたら ASSET_INTEGRITY_MISMATCH（バイト列を渡さない）', async () => {
        const fetchImpl = serve({ [`${MOD_BASE}/a.wasm`]: new Uint8Array([0, 0x61, 0x73, 0x6d, 0xff]) });
        await expect(loadModAsset('a.wasm', { modBase: MOD_BASE, integrity }, { fetchImpl })).rejects.toMatchObject({
            code: UbiErrorCode.ASSET_INTEGRITY_MISMATCH,
        });
    });

    it('manifest に無いパスは取得せずに ASSET_NOT_DECLARED', async () => {
        const fetchImpl = serve({});
        await expect(loadModAsset('other.wasm', { modBase: MOD_BASE, integrity }, { fetchImpl })).rejects.toMatchObject(
            {
                code: UbiErrorCode.ASSET_NOT_DECLARED,
            },
        );
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('Object.prototype のキー名（constructor・__proto__）を宣言済みと誤認しない', async () => {
        const fetchImpl = serve({});
        for (const path of ['constructor', '__proto__', 'toString']) {
            await expect(loadModAsset(path, { modBase: MOD_BASE, integrity }, { fetchImpl })).rejects.toMatchObject({
                code: UbiErrorCode.ASSET_NOT_DECLARED,
            });
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('古い CLI でビルドされ assetIntegrity が無い mod は、理由つきで拒否する', async () => {
        await expect(
            loadModAsset('a.wasm', { modBase: MOD_BASE, integrity: undefined }, { fetchImpl: serve({}) }),
        ).rejects.toMatchObject({ code: UbiErrorCode.ASSET_NOT_DECLARED, message: expect.stringContaining('CLI') });
    });

    it('manifest に悪意あるキー（%2e%2e で modBase を抜ける）があってもパス検証で止める', async () => {
        const fetchImpl = serve({});
        await expect(
            loadModAsset(
                '%2e%2e/%2e%2e/api/v1/users/me',
                { modBase: MOD_BASE, integrity: { '%2e%2e/%2e%2e/api/v1/users/me': sri(WASM) } },
                { fetchImpl },
            ),
        ).rejects.toMatchObject({ code: UbiErrorCode.ASSET_INVALID_PATH });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('modBase が無ければ ASSET_INVALID_PATH', async () => {
        await expect(
            loadModAsset('a.wasm', { modBase: undefined, integrity }, { fetchImpl: serve({}) }),
        ).rejects.toMatchObject({ code: UbiErrorCode.ASSET_INVALID_PATH });
    });

    it('HTTP エラー・通信失敗は ASSET_FETCH_FAILED', async () => {
        await expect(
            loadModAsset(
                'a.wasm',
                { modBase: MOD_BASE, integrity },
                { fetchImpl: serve({ [`${MOD_BASE}/a.wasm`]: 404 }) },
            ),
        ).rejects.toMatchObject({ code: UbiErrorCode.ASSET_FETCH_FAILED });

        const failing = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        await expect(
            loadModAsset('a.wasm', { modBase: MOD_BASE, integrity }, { fetchImpl: failing }),
        ).rejects.toMatchObject({ code: UbiErrorCode.ASSET_FETCH_FAILED });
    });

    it('signal を fetch に渡す（取り消し・Worker 破棄で通信を止める）', async () => {
        const fetchImpl = serve({ [`${MOD_BASE}/a.wasm`]: WASM });
        const controller = new AbortController();
        await loadModAsset('a.wasm', { modBase: MOD_BASE, integrity }, { fetchImpl, signal: controller.signal });
        expect(fetchImpl).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ signal: controller.signal }),
        );
    });
});
