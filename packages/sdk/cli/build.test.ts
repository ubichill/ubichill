/**
 * build.ts（実ビルド）と @ubichill/loader（実ロード検証）を繋ぐ結合テスト。
 *
 * これまでの単体テストは「build側のhash計算」と「load側のhash照合」を別々のフェイク値で
 * 検証しており、両者が本当に同じ規約で一致するかは手動確認に頼っていた。ここでは実際に
 * `mods/pen` を esbuild でビルドし、生成された本物のバイト列を acquireMod に読ませることで、
 * ビルド→保存→ロードの契約を自動テストとして固定する。
 *
 * リポジトリの実ファイル（packages/frontend/public/mods）は汚さず、一時ディレクトリへビルドする
 * （buildMod の publicModsDir/distModsDir 注入を利用）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireMod, buildWorldLock, createHttpLockEntryGetter, resetAcquireCaches } from '@ubichill/loader';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildMod } from './build.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const penModDir = join(repoRoot, 'mods', 'pen');

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
    let manifest: Record<string, unknown>;
    let lockEntry: Record<string, unknown>;
    const modId = 'pen';
    const version = '2.0.0';

    beforeAll(async () => {
        publicDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-public-'));
        distDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-dist-'));
        await buildMod(penModDir, {
            distDir: join(distDir, modId),
            publicDir: join(publicDir, modId),
        });

        const manifestPath = join(publicDir, modId, `v${version}`, 'manifest.json');
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifestFilePath = manifestPath;
        lockEntry = JSON.parse(
            readFileSync(join(publicDir, modId, `v${version}`, 'lock.json'), 'utf-8'),
        ) as Record<string, unknown>;
        const lockComps = lockEntry.components as Record<string, { workerUrl: string }>;
        const relWorkerUrl = lockComps['pen:canvas'].workerUrl.replace(/^\.\//, '');
        workerFilePath = join(publicDir, modId, `v${version}`, relWorkerUrl);
    });

    afterAll(() => {
        rmSync(publicDir, { recursive: true, force: true });
        rmSync(distDir, { recursive: true, force: true });
    });

    afterEach(() => resetAcquireCaches());

    it('manifest に pen:pen の dataFields（color, strokeWidth）が出力される', () => {
        const comp = (manifest.components as Record<string, Record<string, unknown>>)['pen:pen'];
        expect(comp, 'pen:pen が manifest に存在しない').toBeDefined();
        const fields = comp.dataFields as Record<string, Record<string, unknown>>;
        expect(fields.color.type).toBe('color');
        expect(fields.color.default).toBe('#1a1a1a');
        expect(fields.strokeWidth.type).toBe('number');
        expect(fields.strokeWidth.default).toBe(4);
    });

    it('manifest に pen:canvas の canvasTargets が出力される', () => {
        const comp = (manifest.components as Record<string, Record<string, unknown>>)['pen:canvas'];
        expect(comp.canvasTargets).toEqual(['drawing']);
    });

    it('manifest に全3コンポーネント（pen:pen, pen:canvas, pen:tray）が列挙される', () => {
        const comps = manifest.components as Record<string, unknown>;
        expect(Object.keys(comps).sort()).toEqual(['pen:canvas', 'pen:pen', 'pen:tray']);
    });

    it('lock.json の各コンポーネント integrity が実 worker ファイルと一致する', () => {
        const lockComps = lockEntry.components as Record<string, { workerUrl: string; integrity: string }>;
        for (const [, comp] of Object.entries(lockComps)) {
            const path = join(publicDir, modId, `v${version}`, comp.workerUrl.replace(/^\.\//, ''));
            const bytes = readFileSync(path, 'utf-8');
            const hash = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
            expect(comp.integrity).toBe(hash);
        }
    });

    it('実ビルドの manifestIntegrity が実 manifest ファイルと一致する', () => {
        const bytes = readFileSync(manifestFilePath, 'utf-8');
        const hash = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
        expect(lockEntry.manifestIntegrity).toBe(hash);
    });

    it('実ビルド成果物は無改変なら verified、capabilities は lock 天井と一致する', async () => {
        const lock = await buildWorldLock([modId], createHttpLockEntryGetter(publicDir, fsFetch));
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
        const lock = await buildWorldLock([modId], createHttpLockEntryGetter(publicDir, fsFetch));
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
        const lock = await buildWorldLock([modId], createHttpLockEntryGetter(publicDir, fsFetch));
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
        const lock = await buildWorldLock([modId], createHttpLockEntryGetter(publicDir, fsFetch));
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

describe('リモート registry からのバージョン履歴マージ（CI クリーンチェックアウト対策）', () => {
    let publicDir: string;
    let distDir: string;

    beforeEach(() => {
        publicDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-public-'));
        distDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-dist-'));
    });

    afterEach(() => {
        rmSync(publicDir, { recursive: true, force: true });
        rmSync(distDir, { recursive: true, force: true });
    });

    /** `${url}/index.json` にだけ固定レスポンスを返すフェイク fetch。それ以外は 404。 */
    function fakeRegistryFetch(remoteIndex: unknown): typeof fetch {
        return (async (input: string | URL) => {
            const url = String(input);
            if (url.endsWith('/index.json')) {
                return {
                    ok: true,
                    json: async () => remoteIndex,
                } as Response;
            }
            return { ok: false, json: async () => null } as Response;
        }) as typeof fetch;
    }

    it('registryUrl の index.json にある versions 履歴を、今回ビルド分とマージする', async () => {
        const remoteIndex = [
            {
                id: 'pen',
                name: 'pen',
                version: '1.9.0',
                components: ['pen:pen'],
                versions: [
                    { version: '1.9.0', components: ['pen:pen'] },
                    { version: '1.8.0', components: ['pen:pen'] },
                ],
            },
        ];
        const entry = await buildMod(penModDir, {
            distDir: join(distDir, 'pen'),
            publicDir: join(publicDir, 'pen'),
            registryUrl: 'https://example.com/registry',
            fetchImpl: fakeRegistryFetch(remoteIndex),
        });

        const versionNumbers = entry.versions.map((v) => v.version);
        // リモート履歴 (1.9.0 / 1.8.0) + 今回ビルドした現行版 (2.0.0) が新しい順で揃う
        expect(versionNumbers).toEqual(['2.0.0', '1.9.0', '1.8.0']);
    });

    it('registryUrl への fetch が失敗しても（オフライン/404）ビルドは成功する', async () => {
        const failingFetch: typeof fetch = async () => {
            throw new Error('network down');
        };
        const entry = await buildMod(penModDir, {
            distDir: join(distDir, 'pen'),
            publicDir: join(publicDir, 'pen'),
            registryUrl: 'https://example.com/registry',
            fetchImpl: failingFetch,
        });

        expect(entry.versions.map((v) => v.version)).toEqual(['2.0.0']);
    });

    it('registryUrl 未指定なら fetch を一切呼ばず、ローカル履歴のみでビルドする', async () => {
        let called = false;
        const spyFetch: typeof fetch = (async () => {
            called = true;
            return { ok: false, json: async () => null } as Response;
        }) as typeof fetch;

        const entry = await buildMod(penModDir, {
            distDir: join(distDir, 'pen'),
            publicDir: join(publicDir, 'pen'),
            fetchImpl: spyFetch,
        });

        expect(called).toBe(false);
        expect(entry.versions.map((v) => v.version)).toEqual(['2.0.0']);
    });
});
