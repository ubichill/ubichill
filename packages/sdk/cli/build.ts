/**
 * mod.json を自動探索し、Worker コードを esbuild でバンドルする（`ubichill build`）。
 *
 * mod.json の components フィールド（Stage 1 の現代的 ECS 形式）を読み取り、Worker をバンドルする。
 * Component キーは modId 抜きの単純名（例: "screen"）で宣言し、
 * Runtime / ワールド YAML からは `${modId}:${componentName}`（例: "video-player:screen"）で参照する。
 *
 * 出力物（modディレクトリ名を <name>、Component キーを <key> とする）:
 *   <distDir>/<name>/v<version>/<key>/index.<hash>.js
 *   <distDir>/<name>/v<version>/manifest.json
 *   <distDir>/<name>/v<version>/lock.json
 *   <publicDir>/<name>/v<version>/...（同内容。二重出力先が要る Host 向け、無指定なら distDir と同じ）
 *   <publicDir>/<name>/mod.json  ← ローダー用エイリアス（最新バージョン）
 *
 * Worker コード内では Ubi.modBase でバージョン付きアセットベースパスを参照できる。
 * Ubi.modBase は Host が EVT_LIFECYCLE_INIT 時に設定するランタイム値。
 *
 * デフォルトは全て `process.cwd()` 相対（このリポジトリ固有のパスは一切ハードコードしない、
 * 外部 mod 開発者が任意のディレクトリで `ubichill build` を実行できるようにするため）。
 * このリポジトリ自身の実運用パス（`packages/frontend/public/mods` 等）は呼び出し側
 * （ルート package.json の `build:workers` script）が `--public-dir=` 等で明示指定する。
 */
import { CAPABILITY_DETECTORS, detectCapabilities } from '@ubichill/shared';
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export { CAPABILITY_DETECTORS, detectCapabilities };

// ============================================================
// ヘルパー関数
// ============================================================

function copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Component ディレクトリから古いハッシュ付きバンドル (`index.*.js`) を削除する。
 * manifest が古いバンドルを参照していたブラウザキャッシュを段階的に剥がせる
 * ように 1 つだけ残してもよいが、CDN を汚さないため keepFilename 以外は削除。
 */
function cleanOldBundles(dir: string, keepFilename: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name === keepFilename) continue;
        if (!/^index\.[a-f0-9]+\.js$/.test(entry.name)) continue;
        rmSync(join(dir, entry.name));
    }
}

/** ディレクトリ内の全ファイルをルートからの相対パスで列挙する純関数。 */
function listFilesRecursive(rootDir: string, currentDir: string = rootDir): string[] {
    if (!existsSync(currentDir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const abs = join(currentDir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listFilesRecursive(rootDir, abs));
        } else {
            out.push(abs.slice(rootDir.length + 1).split('\\').join('/'));
        }
    }
    return out;
}

/**
 * バイト列（utf-8 文字列）の Subresource Integrity 文字列 `sha256-<base64>` を返す。
 * shared の formatIntegrity と同一規約。ロード側（crypto.subtle）が同じバイト列を
 * hash して照合するため、書き出す文字列そのものを渡すこと。
 */
export function sriOf(text: string): string {
    return `sha256-${createHash('sha256').update(text, 'utf-8').digest('base64')}`;
}

async function bundleWorker(entryPath: string, tsconfig: string | undefined): Promise<string> {
    const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        jsx: 'automatic',
        jsxImportSource: '@ubichill/sdk',
        write: false,
        minify: false,
        tsconfig,
    });
    return result.outputFiles[0].text;
}

// ============================================================
// mod.json の自動探索
// ============================================================

function findModJsonFiles(modsDir: string): string[] {
    const results: string[] = [];
    for (const modName of readdirSync(modsDir, { withFileTypes: true })) {
        if (!modName.isDirectory()) continue;
        const modJsonPath = join(modsDir, modName.name, 'mod.json');
        if (existsSync(modJsonPath)) {
            results.push(modJsonPath);
        }
    }
    return results;
}

// ============================================================
// ビルド
// ============================================================

export interface BuildOptions {
    /** mod.json を探索するディレクトリ（既定: process.cwd()）。 */
    modsDir?: string;
    /** frontend 配信用の出力先（既定: distDir と同じ）。二重出力先が要る Host 向け。 */
    publicModsDir?: string;
    /** CDN 配布用の出力先（既定: `<cwd>/dist/mods`）。 */
    distModsDir?: string;
}

function resolveDirs(options: BuildOptions): { distModsDir: string; publicModsDir: string } {
    const distModsDir = options.distModsDir ?? join(process.cwd(), 'dist', 'mods');
    const publicModsDir = options.publicModsDir ?? distModsDir;
    return { distModsDir, publicModsDir };
}

/** @param modJsonPath mod.json への絶対パス */
export async function buildWorker(modJsonPath: string, options: BuildOptions = {}): Promise<void> {
    const modDir = dirname(modJsonPath);
    const modJson = JSON.parse(readFileSync(modJsonPath, 'utf-8'));

    const modId = modJson.id;
    const modDirName = basename(modDir);
    const version = modJson.version;
    const { distModsDir, publicModsDir } = resolveDirs(options);
    const publicModDir = join(publicModsDir, modDirName);
    const publicVersionDir = join(publicModDir, `v${version}`);
    const distVersionDir = join(distModsDir, modDirName, `v${version}`);

    // tsconfig 検索
    const rootTsconfig = join(modDir, 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : undefined;

    // ── ルート index（npm の "latest" pointer 相当） ──────────────────
    // バージョンへのポインタのみ。エンティティ詳細はバージョン付きマニフェストに分離。
    const rootIndex = JSON.stringify({ id: modId, name: modJson.name, version }, null, 2);
    mkdirSync(publicModDir, { recursive: true });
    writeFileSync(join(publicModDir, 'mod.json'), rootIndex, 'utf-8');
    mkdirSync(join(distModsDir, modDirName), { recursive: true });
    writeFileSync(join(distModsDir, modDirName, 'mod.json'), rootIndex, 'utf-8');

    // ── バージョン付きマニフェスト（ランタイム用・src なし・workerUrl 明示） ──
    // src はビルド時のみ必要なため除去。workerUrl でロード先を明示する。
    mkdirSync(distVersionDir, { recursive: true });
    mkdirSync(publicVersionDir, { recursive: true });

    // ── components 形式 (Stage 1: 現代的 ECS) ───────────────────
    const componentEntries = modJson.components;
    if (!componentEntries || typeof componentEntries !== 'object') {
        console.warn(`⚠️  [${modId}] components フィールドが見つかりません。スキップします。`);
        return;
    }

    // バージョン付きマニフェスト用 components（src 除去・workerUrl 追加、フル型キー化）
    const versionedComponents: Record<string, unknown> = {};
    // lock.json 用 components（worker を持つ Component のみ。integrity=フル sha256）。
    const lockComponents: Record<string, unknown> = {};

    for (const [componentName, componentEntry] of Object.entries(
        componentEntries as Record<string, string | Record<string, unknown>>,
    )) {
        // ワールド YAML / runtime からは "modId:componentName" で参照する
        const componentType = `${modId}:${componentName}`;
        const workerRelPath = typeof componentEntry === 'string' ? componentEntry : componentEntry?.src;
        if (!workerRelPath) {
            // src なし = データ専用 Component。worker をビルドせず manifest にメタだけ記録する。
            const meta = typeof componentEntry === 'string' ? {} : componentEntry;
            versionedComponents[componentType] = { ...meta };
            console.log(`📋 [${componentType}] data-only (no worker)`);
            continue;
        }

        const entryPath = join(modDir, workerRelPath as string);
        if (!existsSync(entryPath)) {
            console.error(`❌ [${componentType}] エントリが見つかりません: ${entryPath}`);
            continue;
        }

        const code = await bundleWorker(entryPath, tsconfig);

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

        // capability をコードから自動検出。手書き宣言があれば和集合（override / 補完）。
        // 手書きは静的解析で漏れる動的アクセス等の補完に使える。
        const detected = detectCapabilities(code);
        const handAuthored = Array.isArray((componentEntry as Record<string, unknown>).capabilities)
            ? ((componentEntry as Record<string, unknown>).capabilities as string[])
            : [];
        const capabilities = [...new Set([...detected, ...handAuthored])].sort();

        // workerUrl を明示、src（ビルド時のみ）は除去。capabilities は自動生成値で上書き。
        const { src: _src, ...runtimeMeta } = typeof componentEntry === 'string' ? {} : componentEntry;
        const workerUrl = `./${componentName}/${outFilename}`;
        versionedComponents[componentType] = {
            ...runtimeMeta,
            capabilities,
            workerUrl,
        };

        // lock: worker バイト列のフル sha256 + capability 天井を固定する。
        // integrity はロード側が同一バイト列（書き出す code そのもの）を hash して照合する。
        lockComponents[componentType] = {
            workerUrl,
            integrity: sriOf(code),
            capabilities,
        };

        console.log(
            `✅ [${componentType}] ${modDirName}/v${version}/${componentName}/${outFilename}` +
                ` [caps: ${capabilities.join(', ') || 'none'}]`,
        );
    }

    // assets/ をバージョン固定パスにコピー（Worker は Ubi.modBase で参照）
    const assetsSrcDir = join(modDir, 'assets');
    let assetFiles: string[] = [];
    if (existsSync(assetsSrcDir)) {
        copyDirRecursive(assetsSrcDir, publicVersionDir);
        copyDirRecursive(assetsSrcDir, distVersionDir);
        assetFiles = listFilesRecursive(assetsSrcDir);
        console.log(`✅ [${modId}] assets → ${modDirName}/v${version}/ (${assetFiles.length} files)`);
    }

    const versionedManifest = JSON.stringify(
        {
            id: modId,
            name: modJson.name,
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
    // ワールド保存時にこの断片を取り込み spec.lock に固定する。
    // manifestIntegrity は上で書き出した manifest 文字列そのものの hash。
    const lock = JSON.stringify(
        {
            id: modId,
            version,
            manifestIntegrity: sriOf(versionedManifest),
            components: lockComponents,
        },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'lock.json'), lock, 'utf-8');
    writeFileSync(join(publicVersionDir, 'lock.json'), lock, 'utf-8');
    console.log(`🔒 [${modId}] lock.json (${Object.keys(lockComponents).length} components)`);
}

/**
 * 全modの index.json を作成する。
 * エディタ等でローカル利用可能modの一覧を取得するために使う。
 * 各エントリは { id, name, version, components[], repositoryPath } 形式。
 */
function writeModIndex(modJsonFiles: string[], options: BuildOptions = {}): void {
    const { distModsDir, publicModsDir } = resolveDirs(options);

    const entries = modJsonFiles.map((modJsonPath) => {
        const modJson = JSON.parse(readFileSync(modJsonPath, 'utf-8'));
        const modId = modJson.id;
        const modDirName = basename(dirname(modJsonPath));
        // Component 型は "modId:componentName" 形式に展開
        const components = modJson.components
            ? Object.keys(modJson.components).map((name) => `${modId}:${name}`)
            : [];
        return {
            id: modId,
            name: modJson.name ?? modId,
            version: modJson.version,
            // dependencies に追加する際の repository path
            repositoryPath: modDirName,
            components,
        };
    });
    const json = JSON.stringify(entries, null, 2);
    mkdirSync(publicModsDir, { recursive: true });
    mkdirSync(distModsDir, { recursive: true });
    writeFileSync(join(publicModsDir, 'index.json'), json, 'utf-8');
    writeFileSync(join(distModsDir, 'index.json'), json, 'utf-8');
    console.log(`📋 mod index: ${entries.length} entries`);
}

/**
 * `argv`（サブコマンド名を除いた残り引数）から全ての mod をビルドする。
 * `--mods-dir=` / `--public-mods-dir=` / `--dist-dir=` はすべて未指定なら
 * `process.cwd()` 基準（このリポジトリ固有のパスはライブラリ既定にしない）。
 */
export async function runBuild(argv: string[]): Promise<void> {
    const argValue = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

    const modsDir = argValue('mods-dir') ? resolve(argValue('mods-dir') as string) : process.cwd();
    const distModsDir = argValue('dist-dir') ? resolve(argValue('dist-dir') as string) : undefined;
    const publicModsDir = argValue('public-mods-dir') ? resolve(argValue('public-mods-dir') as string) : undefined;

    console.log('🔨 Building mods...');
    const modJsonFiles = findModJsonFiles(modsDir);

    if (modJsonFiles.length === 0) {
        console.warn(`⚠️  mod.json が見つかりません（${modsDir}）`);
        return;
    }

    const options: BuildOptions = { publicModsDir, distModsDir };
    for (const modJsonPath of modJsonFiles) {
        await buildWorker(modJsonPath, options);
    }

    writeModIndex(modJsonFiles, options);

    const { distModsDir: resolvedDist } = resolveDirs(options);
    console.log('🎉 All mods built.');
    console.log(`📦 出力先: ${resolvedDist}`);
}
