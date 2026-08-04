/**
 * build.ts（実ビルド）と @ubichill/loader（実ロード検証）を繋ぐ結合テスト。
 *
 * これまでの単体テストは「build側のhash計算」と「load側のhash照合」を別々のフェイク値で
 * 検証しており、両者が本当に同じ規約で一致するかは手動確認に頼っていた。ここでは実際に
 * `mods/pen` を esbuild でビルドし、生成された本物のバイト列を acquireMod に読ませることで、
 * ビルド→保存→ロードの契約を自動テストとして固定する。
 *
 * リポジトリの実ファイル（packages/frontend/public/mods）は汚さず、一時ディレクトリへビルドする
 * （buildWorker の publicModsDir/distModsDir 注入を利用）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireMod, buildWorldLock, createHttpLockEntryGetter, resetAcquireCaches } from '@ubichill/loader';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildWorker } from './build.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const penModJson = join(repoRoot, 'mods', 'pen', 'mod.json');

interface FakeFetchResponse {
    ok: boolean;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

/** input をそのまま絶対 fs パスとして扱う FetchLike（テスト専用。FetchLike は Promise を返す契約）。 */
async function fsFetch(input: string): Promise<FakeFetchResponse> {
    let bytes: Buffer;
    try {
        bytes = readFileSync(input);
    } catch {
        return {
            ok: false,
            headers: { get: () => null },
            json: async () => null,
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
        };
    }
    return {
        ok: true,
        headers: { get: () => null },
        json: async () => JSON.parse(bytes.toString('utf-8')),
        text: async () => bytes.toString('utf-8'),
        arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    };
}

describe('build → loader 結合テスト（実ビルド × 実hash照合）', () => {
    let publicDir: string;
    let distDir: string;
    let workerFilePath: string;
    let manifestFilePath: string;

    beforeAll(async () => {
        publicDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-public-'));
        distDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-dist-'));
        await buildWorker(penModJson, { publicModsDir: publicDir, distModsDir: distDir });

        const lockEntry = JSON.parse(readFileSync(join(publicDir, 'pen', 'v2.0.0', 'lock.json'), 'utf-8'));
        const relWorkerUrl = lockEntry.components['pen:canvas'].workerUrl.replace(/^\.\//, '');
        workerFilePath = join(publicDir, 'pen', 'v2.0.0', relWorkerUrl);
        manifestFilePath = join(publicDir, 'pen', 'v2.0.0', 'manifest.json');
    });

    afterAll(() => {
        rmSync(publicDir, { recursive: true, force: true });
        rmSync(distDir, { recursive: true, force: true });
    });

    afterEach(() => resetAcquireCaches());

    it('実ビルド成果物は無改変なら verified、capabilities は lock 天井と一致する', async () => {
        const lock = await buildWorldLock(['pen'], createHttpLockEntryGetter(publicDir, fsFetch));
        const result = await acquireMod('pen:canvas', {
            baseUrl: publicDir,
            lock,
            sourceKind: 'github',
            fetchImpl: fsFetch,
        });

        expect(typeof result === 'object' && 'workerCode' in result).toBe(true);
        if (typeof result === 'object' && 'workerCode' in result) {
            expect(result.workerCode.length).toBeGreaterThan(0);
            expect(result.capabilities).toEqual(lock.mods.pen.components['pen:canvas'].capabilities);
        }
    });

    it('worker バイト列を1バイト改竄すると外部 provenance では integrity-mismatch で拒否される', async () => {
        const lock = await buildWorldLock(['pen'], createHttpLockEntryGetter(publicDir, fsFetch));
        const original = readFileSync(workerFilePath);
        writeFileSync(workerFilePath, Buffer.concat([original, Buffer.from(' ')]));
        try {
            const result = await acquireMod('pen:canvas', {
                baseUrl: publicDir,
                lock,
                sourceKind: 'github',
                fetchImpl: fsFetch,
            });
            expect(result).toEqual({ rejected: 'integrity-mismatch' });
        } finally {
            writeFileSync(workerFilePath, original);
        }
    });

    it('manifest.json を改竄すると外部 provenance では manifest-mismatch で拒否される', async () => {
        const lock = await buildWorldLock(['pen'], createHttpLockEntryGetter(publicDir, fsFetch));
        const original = readFileSync(manifestFilePath);
        writeFileSync(manifestFilePath, Buffer.concat([original, Buffer.from(' ')]));
        try {
            const result = await acquireMod('pen:canvas', {
                baseUrl: publicDir,
                lock,
                sourceKind: 'remote-instance',
                fetchImpl: fsFetch,
            });
            expect(result).toEqual({ rejected: 'manifest-mismatch' });
        } finally {
            writeFileSync(manifestFilePath, original);
        }
    });

    it('local provenance は同じ改竄でも警告続行し、manifest 由来の capabilities で読み込む', async () => {
        const lock = await buildWorldLock(['pen'], createHttpLockEntryGetter(publicDir, fsFetch));
        const original = readFileSync(workerFilePath);
        writeFileSync(workerFilePath, Buffer.concat([original, Buffer.from(' ')]));
        try {
            const result = await acquireMod('pen:canvas', {
                baseUrl: publicDir,
                lock,
                sourceKind: 'local',
                fetchImpl: fsFetch,
            });
            expect(typeof result === 'object' && 'workerCode' in result).toBe(true);
        } finally {
            writeFileSync(workerFilePath, original);
        }
    });
});
