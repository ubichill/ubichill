/**
 * CLI ビルドツールのコア — mod.json を廃止し、package.json + Worker コード内の
 * `export const config` を元にマニフェスト・lock.json を自動生成する。
 */
import { detectCapabilities } from '@ubichill/shared';
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** Worker ファイルからコンポーネント名を導出 (ex: `canvas.worker.ts` → `canvas`) */
function componentNameFromFile(file: string): string {
    return file.replace(/\.worker\.[jt]sx?$/, '');
}

/** src/ 以下の *.worker.ts(x) を再帰的にスキャン */
function findWorkerFiles(srcDir: string): string[] {
    const results: string[] = [];
    function walk(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(p);
            } else if (entry.isFile() && /\.worker\.[jt]sx?$/.test(entry.name)) {
                results.push(p);
            }
        }
    }
    walk(srcDir);
    return results;
}

/** `export const config =` のあるファイルのみを Worker として扱う */
function isWorkerFile(path: string): boolean {
    const code = readFileSync(path, 'utf-8');
    return /export\s+const\s+config\s*(?::\s*[^=]+)?\s*=/.test(code);
}

/** `export const config =` の内容を brace-counting で抽出する簡易解析。
 * ネストした `{}` を含む config（dataFields, defaultTransform 等）にも対応。 */
function extractConfigFromCode(code: string): Record<string, unknown> | null {
    const startMatch = code.match(/export\s+const\s+config\s*(?::\s*[^=]+)?\s*=\s*/);
    if (startMatch?.index === undefined) return null;
    const startIdx = startMatch.index + startMatch[0].length;
    const trimmed = code.slice(startIdx).trimStart();
    if (!trimmed.startsWith('{')) return null;

    let depth = 0;
    let endIdx = -1;
    for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '{') depth++;
        else if (trimmed[i] === '}') {
            depth--;
            if (depth === 0) { endIdx = i + 1; break; }
        }
    }
    if (endIdx === -1) return null;

    const objLiteral = trimmed.slice(0, endIdx);
    try {
        return new Function(`return ${objLiteral}`)() as Record<string, unknown>;
    } catch {
        return null;
    }
}

function copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            writeFileSync(destPath, readFileSync(srcPath));
        }
    }
}

function cleanOldBundles(dir: string, keepFilename: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name !== keepFilename && entry.name.startsWith('index.')) {
            const p = join(dir, entry.name);
            try {
                unlinkSync(p);
            } catch {
                // ignore
            }
        }
    }
}

function listFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listFilesRecursive(abs));
        } else {
            out.push(abs);
        }
    }
    return out;
}

function sriOf(text: string): string {
    const hash = createHash('sha256').update(text).digest('base64');
    return `sha256-${hash}`;
}

async function bundleWorker(entryPath: string, tsconfig?: string): Promise<string> {
    const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        jsx: 'transform',
        jsxImportSource: '@ubichill/sdk',
        write: false,
        minify: true,
        tsconfig,
    });
    const out = result.outputFiles?.[0];
    if (!out) throw new Error(`esbuild failed for ${entryPath}`);
    return out.text;
}

// ============================================================
// ビルド
// ============================================================

export interface BuildOptions {
    /** mod のソースディレクトリ（既定: process.cwd()）。 */
    modDir?: string;
    /** フロントエンド配信用の出力先（既定: distDir と同じ）。 */
    publicDir?: string;
    /** CDN 配布用の出力先（既定: `<modDir>/dist`）。 */
    distDir?: string;
}

function resolveDirs(options: BuildOptions): { distDir: string; publicDir: string } {
    const distDir = options.distDir ?? join(options.modDir ?? process.cwd(), 'dist');
    const publicDir = options.publicDir ?? distDir;
    return { distDir, publicDir };
}

function readPackageJson(modDir: string): { id: string; name: string; version: string } {
    const path = join(modDir, 'package.json');
    if (!existsSync(path)) {
        throw new Error(`package.json not found in ${modDir}`);
    }
    const pkg = JSON.parse(readFileSync(path, 'utf-8'));
    const id = pkg.ubichill?.id ?? pkg.name?.replace(/^@ubichill\/(?:mod-)?/, '') ?? basename(modDir);
    const name = pkg.ubichill?.name ?? pkg.description ?? id;
    const version = pkg.version;
    if (!version) {
        throw new Error(`package.json に version が必要です: ${path}`);
    }
    return { id, name, version };
}

/** @param modDir mod のルートディレクトリへの絶対パス */
export async function buildMod(modDir: string, options: BuildOptions = {}): Promise<void> {
    const { id, name, version } = readPackageJson(modDir);
    const { distDir, publicDir } = resolveDirs(options);

    // tsconfig 検索
    const rootTsconfig = join(modDir, 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : undefined;

    // ── ルート index（npm の "latest" pointer 相当） ──────────────────
    // バージョンへのポインタのみ。エンティティ詳細はバージョン付きマニフェストに分離。
    const rootIndex = JSON.stringify({ id, name, version }, null, 2);
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, 'mod.json'), rootIndex, 'utf-8');

    const publicVersionDir = join(publicDir, `v${version}`);
    const distVersionDir = join(distDir, `v${version}`);
    mkdirSync(distVersionDir, { recursive: true });
    mkdirSync(publicVersionDir, { recursive: true });

    // ── Worker 自動探索 ───────────────────────────────────────
    const srcDir = join(modDir, 'src');
    const workerFiles = findWorkerFiles(srcDir);

    const versionedComponents: Record<string, unknown> = {};
    const lockComponents: Record<string, unknown> = {};

    for (const workerPath of workerFiles) {
        const relPath = workerPath.replace(srcDir + '/', '');
        const componentName = componentNameFromFile(relPath);
        const componentType = `${id}:${componentName}`;

        // `export const config` を持つファイルのみを処理する
        if (!isWorkerFile(workerPath)) {
            console.log(`📋 [${componentType}] skipped (no export const config)`);
            continue;
        }

        const code = await bundleWorker(workerPath, tsconfig);

        // コンテンツハッシュ（8文字）でキャッシュバスティング
        const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
        const outFilename = `index.${hash}.js`;

        // dist: バージョン固定
        const distComponentDir = join(distVersionDir, componentName);
        mkdirSync(distComponentDir, { recursive: true });
        cleanOldBundles(distComponentDir, outFilename);
        writeFileSync(join(distComponentDir, outFilename), code, 'utf-8');

        // public: バージョン固定パス（CDN キャッシュバスティング用）
        const publicComponentDir = join(publicVersionDir, componentName);
        mkdirSync(publicComponentDir, { recursive: true });
        cleanOldBundles(publicComponentDir, outFilename);
        writeFileSync(join(publicComponentDir, outFilename), code, 'utf-8');

        // capability をコードから自動検出。
        const detected = detectCapabilities(code);

        // config からメタデータを取得
        const srcCode = readFileSync(workerPath, 'utf-8');
        const config = extractConfigFromCode(srcCode);
        const declaredCapabilities = Array.isArray(config?.capabilities)
            ? (config.capabilities as string[])
            : [];

        // 宣言された capability と検出結果を突き合わせて警告
        const missing = declaredCapabilities.filter((cap) => !detected.includes(cap));
        const excess = detected.filter((cap) => !declaredCapabilities.includes(cap));
        if (missing.length > 0) {
            console.warn(
                `⚠️  [${componentType}] 宣言漏れ: ${missing.join(', ')} (コード中に検出されず)`,
            );
        }
        if (excess.length > 0) {
            console.warn(
                `⚠️  [${componentType}] 過剰検出: ${excess.join(', ')} (config.capabilities に宣言なし)`,
            );
        }

        // マニフェスト用: 検出結果と宣言の和集合（セキュリティ的に過剰許可より安全）
        const capabilitySet = new Set<string>();
        for (const cap of detected) capabilitySet.add(cap);
        for (const cap of declaredCapabilities) capabilitySet.add(cap);
        const capabilities = Array.from(capabilitySet).sort();

        const workerUrl = `./${componentName}/${outFilename}`;
        versionedComponents[componentType] = {
            capabilities,
            workerUrl,
            ...(config ?? {}),
        };

        // lock: worker バイト列のフル sha256 + capability 天井を固定する。
        lockComponents[componentType] = {
            workerUrl,
            integrity: sriOf(code),
            capabilities,
        };

        console.log(
            `✅ [${componentType}] ${componentName}/${outFilename}` +
                ` [caps: ${capabilities.join(', ') || 'none'}]`,
        );
    }

    // assets/ をバージョン固定パスにコピー（Worker は Ubi.modBase で参照）
    const assetsSrcDir = join(modDir, 'assets');
    let assetFiles: string[] = [];
    if (existsSync(assetsSrcDir)) {
        copyDirRecursive(assetsSrcDir, publicVersionDir);
        copyDirRecursive(assetsSrcDir, distVersionDir);
        assetFiles = listFilesRecursive(assetsSrcDir).map((p) => p.replace(assetsSrcDir + '/', ''));
        console.log(`✅ [${id}] assets → v${version}/ (${assetFiles.length} files)`);
    }

    const versionedManifest = JSON.stringify(
        {
            id,
            name,
            version,
            components: versionedComponents,
            assets: assetFiles,
        },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'manifest.json'), versionedManifest, 'utf-8');
    writeFileSync(join(publicVersionDir, 'manifest.json'), versionedManifest, 'utf-8');

    // ── lock.json（ModLockEntry 形状）─────────────────────────────
    const lock = JSON.stringify(
        {
            id,
            version,
            manifestIntegrity: sriOf(versionedManifest),
            components: lockComponents,
        },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'lock.json'), lock, 'utf-8');
    writeFileSync(join(publicVersionDir, 'lock.json'), lock, 'utf-8');
    console.log(`🔒 [${id}] lock.json (${Object.keys(lockComponents).length} components)`);
}

/**
 * 全 mod を一括ビルド（モノレポ用）。
 */
export async function runBuild(args: string[]): Promise<void> {
    const argValue = (flag: string): string | undefined =>
        args.find((a) => a.startsWith(flag))?.slice(flag.length);

    const modsDir = argValue('--mods-dir=') ?? 'mods';
    const distDir = argValue('--dist-dir=') ?? join(process.cwd(), 'dist', 'mods');
    const publicDir = argValue('--public-mods-dir=') ?? distDir;

    for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const modDir = join(modsDir, entry.name);
        const pkgJsonPath = join(modDir, 'package.json');
        if (!existsSync(pkgJsonPath)) continue;

        const { id } = readPackageJson(modDir);
        const modDistDir = join(distDir, id);
        const modPublicDir = join(publicDir, id);

        console.log(`\n🔨 [${entry.name}] building...`);
        await buildMod(modDir, { distDir: modDistDir, publicDir: modPublicDir });
    }
}
