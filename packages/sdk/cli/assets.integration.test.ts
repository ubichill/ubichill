/**
 * 同梱アセットの「build が付けた integrity」と「Host が読み込み時に照合する integrity」が同じ規約か確かめる。
 * mods/wasm-demo を一時ディレクトリへ実ビルドし、Host のアセットローダーで実ファイルを読む。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UbiErrorCode } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// sandbox は sdk に依存するため、パッケージ名ではなくソースを直接読む（テスト専用）。
import { loadModAsset } from '../../sandbox/src/host/assetLoader.ts';
import { buildMod, collectAssets } from './build.ts';
import { verifyAllModLocks } from './verify.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const demoModDir = join(repoRoot, 'mods', 'wasm-demo');
const MOD_BASE = 'https://cdn.example.com/mods/wasm-demo/v1.0.0';

describe('同梱アセット: build → manifest → Host の照合', () => {
    let distDir: string;
    let publicDir: string;
    let versionDir: string;
    let manifest: { assets: string[]; assetIntegrity: Record<string, string> };

    /** modBase 配下の URL を一時ディレクトリの実ファイルに対応させる fetch。 */
    const fsFetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (!url.startsWith(`${MOD_BASE}/`)) return new Response(null, { status: 404 });
        try {
            return new Response(readFileSync(join(versionDir, url.slice(MOD_BASE.length + 1))));
        } catch {
            return new Response(null, { status: 404 });
        }
    }) as typeof fetch;

    beforeAll(async () => {
        distDir = mkdtempSync(join(tmpdir(), 'ubichill-assets-dist-'));
        publicDir = mkdtempSync(join(tmpdir(), 'ubichill-assets-public-'));
        await buildMod(demoModDir, { distDir: join(distDir, 'wasm-demo'), publicDir: join(publicDir, 'wasm-demo') });
        versionDir = join(distDir, 'wasm-demo', 'v1.0.0');
        manifest = JSON.parse(readFileSync(join(versionDir, 'manifest.json'), 'utf-8'));
    });

    afterAll(() => {
        rmSync(distDir, { recursive: true, force: true });
        rmSync(publicDir, { recursive: true, force: true });
    });

    it('manifest に全アセットの SRI が載り、一覧はソート済み', () => {
        expect(manifest.assets).toEqual(['fnv1a.wasm', 'sample.txt']);
        expect(Object.keys(manifest.assetIntegrity)).toEqual(manifest.assets);
        for (const sri of Object.values(manifest.assetIntegrity)) expect(sri).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    });

    it('Host は build が付けた integrity でアセットを受け入れ、WASM として実行できる', async () => {
        const bytes = await loadModAsset(
            'fnv1a.wasm',
            { modBase: MOD_BASE, integrity: manifest.assetIntegrity },
            { fetchImpl: fsFetch },
        );
        const { instance } = await WebAssembly.instantiate(bytes, {});
        const memory = instance.exports.memory as WebAssembly.Memory;
        new Uint8Array(memory.buffer).set(new TextEncoder().encode('a'));
        expect(((instance.exports.fnv1a as (p: number, l: number) => number)(0, 1) >>> 0).toString(16)).toBe('e40c292c');
    });

    it('配布後にアセットを 1 バイト書き換えると、Host は拒否し ubichill verify も失敗する', async () => {
        const wasmPath = join(versionDir, 'fnv1a.wasm');
        const original = readFileSync(wasmPath);
        try {
            const tampered = Uint8Array.from(original);
            tampered[tampered.length - 1] ^= 0x01;
            writeFileSync(wasmPath, tampered);

            await expect(
                loadModAsset('fnv1a.wasm', { modBase: MOD_BASE, integrity: manifest.assetIntegrity }, { fetchImpl: fsFetch }),
            ).rejects.toMatchObject({ code: UbiErrorCode.ASSET_INTEGRITY_MISMATCH });
            expect(verifyAllModLocks(distDir)).toEqual([expect.stringContaining('アセットの integrity 不一致 (fnv1a.wasm')]);
        } finally {
            writeFileSync(wasmPath, original);
        }
        expect(verifyAllModLocks(distDir)).toEqual([]);
    });

    it('アセットの無い mod の manifest には assetIntegrity を出さない（既存 lock を変えない）', async () => {
        const out = mkdtempSync(join(tmpdir(), 'ubichill-assets-pen-'));
        try {
            await buildMod(join(repoRoot, 'mods', 'pen'), { distDir: join(out, 'd'), publicDir: join(out, 'p') });
            const penManifest = JSON.parse(readFileSync(join(out, 'd', 'v2.0.0', 'manifest.json'), 'utf-8'));
            expect(penManifest.assets).toEqual([]);
            expect(penManifest).not.toHaveProperty('assetIntegrity');
        } finally {
            rmSync(out, { recursive: true, force: true });
        }
    });
});

describe('collectAssets', () => {
    it('build の出力と同じ名前（manifest.json・Component のディレクトリ）を拒否する', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ubichill-assets-clash-'));
        try {
            writeFileSync(join(dir, 'manifest.json'), '{}');
            expect(() => collectAssets(dir, new Set())).toThrow('manifest.json');

            rmSync(join(dir, 'manifest.json'));
            mkdirSync(join(dir, 'checksum'));
            writeFileSync(join(dir, 'checksum', 'index.js'), '');
            expect(() => collectAssets(dir, new Set(['checksum']))).toThrow('checksum/index.js');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('assets/ が無ければ空', () => {
        expect(collectAssets(join(tmpdir(), 'no-such-assets-dir'), new Set())).toEqual({ files: [], integrity: {} });
    });

    it('入れ子のパスは / 区切りのキーになる', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ubichill-assets-nested-'));
        try {
            mkdirSync(join(dir, 'lib', 'py'), { recursive: true });
            writeFileSync(join(dir, 'lib', 'py', 'stdlib.zip'), 'zip');
            expect(collectAssets(dir, new Set()).files).toEqual(['lib/py/stdlib.zip']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

