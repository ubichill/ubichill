/**
 * build-workers.mjs
 *
 * plugins/ 以下の plugin.json を自動探索し、Worker コードを esbuild でバンドルします。
 *
 * plugin.json の components フィールド（Stage 1 の現代的 ECS 形式）を読み取り、Worker をバンドルします。
 * Component キーは pluginId 抜きの単純名（例: "screen"）で宣言し、
 * Runtime / ワールド YAML からは `${pluginId}:${componentName}`（例: "video-player:screen"）で参照します。
 *
 * 出力物 (プラグインディレクトリ名を <name>、Component キーを <key> とする):
 *   dist/plugins/<name>/v<version>/<key>/index.js
 *   dist/plugins/<name>/v<version>/manifest.json
 *   public/plugins/<name>/v<version>/<key>/index.js
 *   public/plugins/<name>/v<version>/manifest.json
 *   public/plugins/<name>/v<version>/  ← assets/ もここにコピー（バージョン固定）
 *   public/plugins/<name>/plugin.json  ← ローダー用エイリアス（最新バージョン）
 *
 * Worker コード内では Ubi.pluginBase でバージョン付きアセットベースパスを参照できます。
 * Ubi.pluginBase は Host が EVT_LIFECYCLE_INIT 時に設定するランタイム値です。
 * 例: `${Ubi.pluginBase}/templates/manifest.json`
 *      → https://cdn.example.com/plugins/video-player/v2.1.0/templates/manifest.json
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// --dist-dir=<path> で出力先を上書き可能（デフォルト: dist/plugins/）
const distDirArg = process.argv.slice(2).find((a) => a.startsWith('--dist-dir='));
const distPluginsDir = distDirArg ? join(root, distDirArg.split('=')[1]) : join(root, 'dist', 'plugins');

// ============================================================
// ヘルパー関数
// ============================================================

function copyDirRecursive(src, dest) {
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
function cleanOldBundles(dir, keepFilename) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name === keepFilename) continue;
        if (!/^index\.[a-f0-9]+\.js$/.test(entry.name)) continue;
        rmSync(join(dir, entry.name));
    }
}

/** ディレクトリ内の全ファイルをルートからの相対パスで列挙する純関数。 */
function listFilesRecursive(rootDir, currentDir = rootDir) {
    if (!existsSync(currentDir)) return [];
    const out = [];
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

// ============================================================
// capability 自動検出（静的解析）
// ============================================================

/**
 * バンドル済み Worker コードから使用中の Ubi API を静的検出し、capability を推定する。
 *
 * これは **情報表示（マニフェスト）用の over-approximate な推定**であり、セキュリティ境界
 * ではない。実際の enforcement は実行時ゲート + ユーザー承認（PluginHostManager）で行われ、
 * 検出漏れ（動的アクセス・完全な分割代入など）は実行時に必ず拾われる。よって過剰申告寄り。
 *
 * capability 名は sandbox の CAPABILITY_CATALOG と一致させること
 * （packages/sandbox/src/host/capability.ts）。
 */
const CAPABILITY_DETECTORS = [
    { cap: 'net:fetch', test: (c) => /\bUbi\.fetch\b/.test(c) },
    { cap: 'ui:render', test: (c) => /\bUbi\.ui\b/.test(c) },
    { cap: 'ui:toast', test: (c) => /\.showToast\s*\(/.test(c) },
    // entity / state はどちらも読み書きしうるため read/update を両方申告（over-approx）
    { cap: 'scene:read', test: (c) => /\bUbi\.(entity|state)\b/.test(c) },
    { cap: 'scene:update', test: (c) => /\bUbi\.(entity|state)\b/.test(c) },
    { cap: 'net:emit', test: (c) => /\bUbi\.event\b/.test(c) },
    { cap: 'net:broadcast', test: (c) => /\.broadcast\s*\(/.test(c) },
    { cap: 'net:host-message', test: (c) => /\.sendToHost\s*\(/.test(c) },
    { cap: 'canvas:draw', test: (c) => /\bUbi\.canvas\b/.test(c) },
    { cap: 'video:control', test: (c) => /\bUbi\.media\b/.test(c) },
];

/** バンドル済みコードから capability 一覧を検出する（ソート済み・重複なし）。 */
export function detectCapabilities(code) {
    return CAPABILITY_DETECTORS.filter((d) => d.test(code))
        .map((d) => d.cap)
        .sort();
}

async function bundleWorker(entryPath, tsconfig, defines) {
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
        define: defines,
    });
    return result.outputFiles[0].text;
}

// ============================================================
// plugin.json の自動探索
// ============================================================

function findPluginJsonFiles(pluginsDir) {
    const results = [];
    for (const pluginName of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!pluginName.isDirectory()) continue;
        const pluginJsonPath = join(pluginsDir, pluginName.name, 'plugin.json');
        if (existsSync(pluginJsonPath)) {
            results.push(pluginJsonPath);
        }
    }
    return results;
}

// ============================================================
// ビルド
// ============================================================

export async function buildWorker(pluginJsonPath) {
    const pluginDir = dirname(pluginJsonPath);
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));

    const pluginId = pluginJson.id;
    const pluginDirName = basename(pluginDir);
    const version = pluginJson.version;
    const publicPluginDir = join(root, 'packages', 'frontend', 'public', 'plugins', pluginDirName);
    const publicVersionDir = join(publicPluginDir, `v${version}`);
    const distVersionDir = join(distPluginsDir, pluginDirName, `v${version}`);

    // tsconfig 検索
    const rootTsconfig = join(pluginDir, 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : undefined;

    // ── ルート index（npm の "latest" pointer 相当） ──────────────────
    // バージョンへのポインタのみ。エンティティ詳細はバージョン付きマニフェストに分離。
    const rootIndex = JSON.stringify({ id: pluginId, name: pluginJson.name, version }, null, 2);
    mkdirSync(publicPluginDir, { recursive: true });
    writeFileSync(join(publicPluginDir, 'plugin.json'), rootIndex, 'utf-8');
    mkdirSync(join(distPluginsDir, pluginDirName), { recursive: true });
    writeFileSync(join(distPluginsDir, pluginDirName, 'plugin.json'), rootIndex, 'utf-8');

    // ── バージョン付きマニフェスト（ランタイム用・src なし・workerUrl 明示） ──
    // src はビルド時のみ必要なため除去。workerUrl でロード先を明示する。
    mkdirSync(distVersionDir, { recursive: true });
    mkdirSync(publicVersionDir, { recursive: true });

    // ── components 形式 (Stage 1: 現代的 ECS) ───────────────────
    const componentEntries = pluginJson.components;
    if (!componentEntries || typeof componentEntries !== 'object') {
        console.warn(`⚠️  [${pluginId}] components フィールドが見つかりません。スキップします。`);
        return;
    }

    // バージョン付きマニフェスト用 components（src 除去・workerUrl 追加、フル型キー化）
    const versionedComponents = {};

    for (const [componentName, componentEntry] of Object.entries(componentEntries)) {
        // ワールド YAML / runtime からは "pluginId:componentName" で参照する
        const componentType = `${pluginId}:${componentName}`;
        const workerRelPath = typeof componentEntry === 'string' ? componentEntry : componentEntry?.src;
        if (!workerRelPath) {
            // src なし = データ専用 Component。worker をビルドせず manifest にメタだけ記録する。
            const meta = typeof componentEntry === 'string' ? {} : componentEntry;
            versionedComponents[componentType] = { ...meta };
            console.log(`📋 [${componentType}] data-only (no worker)`);
            continue;
        }

        const entryPath = join(pluginDir, workerRelPath);
        if (!existsSync(entryPath)) {
            console.error(`❌ [${componentType}] エントリが見つかりません: ${entryPath}`);
            continue;
        }

        const code = await bundleWorker(entryPath, tsconfig, {});

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
        const handAuthored = Array.isArray(componentEntry.capabilities) ? componentEntry.capabilities : [];
        const capabilities = [...new Set([...detected, ...handAuthored])].sort();

        // workerUrl を明示、src（ビルド時のみ）は除去。capabilities は自動生成値で上書き。
        const { src: _src, ...runtimeMeta } = typeof componentEntry === 'string' ? {} : componentEntry;
        versionedComponents[componentType] = {
            ...runtimeMeta,
            capabilities,
            workerUrl: `./${componentName}/${outFilename}`,
        };

        console.log(
            `✅ [${componentType}] /plugins/${pluginDirName}/v${version}/${componentName}/${outFilename}` +
                ` [caps: ${capabilities.join(', ') || 'none'}]`,
        );
    }

    // assets/ をバージョン固定パスにコピー（Worker は Ubi.pluginBase で参照）
    const assetsSrcDir = join(pluginDir, 'assets');
    let assetFiles = [];
    if (existsSync(assetsSrcDir)) {
        copyDirRecursive(assetsSrcDir, publicVersionDir);
        copyDirRecursive(assetsSrcDir, distVersionDir);
        assetFiles = listFilesRecursive(assetsSrcDir);
        console.log(`✅ [${pluginId}] assets → /plugins/${pluginDirName}/v${version}/ (${assetFiles.length} files)`);
    }

    const versionedManifest = JSON.stringify(
        {
            id: pluginId,
            name: pluginJson.name,
            version,
            components: versionedComponents,
            assets: assetFiles,
        },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'manifest.json'), versionedManifest, 'utf-8');
    writeFileSync(join(publicVersionDir, 'manifest.json'), versionedManifest, 'utf-8');
}

// ============================================================
// エントリーポイント
// ============================================================

/**
 * 全プラグインの index.json を作成する。
 * エディタ等でローカル利用可能プラグインの一覧を取得するために使う。
 * 各エントリは { id, name, version, kinds[] } 形式（plugin.json + バージョン付き manifest を集約）。
 */
function writePluginIndex(pluginJsonFiles) {
    const entries = [];
    for (const pluginJsonPath of pluginJsonFiles) {
        const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
        const pluginId = pluginJson.id;
        const pluginDirName = basename(dirname(pluginJsonPath));
        // Component 型は "pluginId:componentName" 形式に展開
        const components = pluginJson.components
            ? Object.keys(pluginJson.components).map((name) => `${pluginId}:${name}`)
            : [];
        entries.push({
            id: pluginId,
            name: pluginJson.name ?? pluginId,
            version: pluginJson.version,
            // dependencies に追加する際の repository path
            repositoryPath: `plugins/${pluginDirName}`,
            components,
        });
    }
    const json = JSON.stringify(entries, null, 2);
    const publicIndexPath = join(root, 'packages', 'frontend', 'public', 'plugins', 'index.json');
    const distIndexPath = join(distPluginsDir, 'index.json');
    writeFileSync(publicIndexPath, json, 'utf-8');
    writeFileSync(distIndexPath, json, 'utf-8');
    console.log(`📋 plugin index: ${entries.length} entries → public/plugins/index.json, dist/plugins/index.json`);
}

async function main() {
    console.log('🔨 Building plugin workers...');
    const pluginsDir = join(root, 'plugins');
    const pluginJsonFiles = findPluginJsonFiles(pluginsDir);

    if (pluginJsonFiles.length === 0) {
        console.warn('⚠️  plugin.json が見つかりません');
        return;
    }

    for (const pluginJsonPath of pluginJsonFiles) {
        await buildWorker(pluginJsonPath);
    }

    writePluginIndex(pluginJsonFiles);

    console.log('🎉 All workers built.');
    console.log(`📦 CDN 配布用: dist/plugins/`);
}

// スクリプトとして直接実行された場合のみ main() を走らせる。
// `watch-workers.mjs` が import { buildWorker } から取ってきたとき、main() が
// 副作用として呼ばれて二重ビルドになるのを防ぐ。
// パス比較は fileURLToPath で URL → 実パスに正規化 (スペース・Windows 対応)。
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((err) => {
        console.error('❌ Worker build failed:', err);
        process.exit(1);
    });
}
