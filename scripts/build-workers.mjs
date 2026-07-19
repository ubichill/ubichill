/**
 * build-workers.mjs
 *
 * mods/ 以下の mod.json を自動探索し、Worker コードを esbuild でバンドルします。
 *
 * mod.json の components フィールド（Stage 1 の現代的 ECS 形式）を読み取り、Worker をバンドルします。
 * Component キーは modId 抜きの単純名（例: "screen"）で宣言し、
 * Runtime / ワールド YAML からは `${modId}:${componentName}`（例: "video-player:screen"）で参照します。
 *
 * 出力物 (modディレクトリ名を <name>、Component キーを <key> とする):
 *   dist/mods/<name>/v<version>/<key>/index.js
 *   dist/mods/<name>/v<version>/manifest.json
 *   public/mods/<name>/v<version>/<key>/index.js
 *   public/mods/<name>/v<version>/manifest.json
 *   public/mods/<name>/v<version>/  ← assets/ もここにコピー（バージョン固定）
 *   public/mods/<name>/mod.json  ← ローダー用エイリアス（最新バージョン）
 *
 * Worker コード内では Ubi.modBase でバージョン付きアセットベースパスを参照できます。
 * Ubi.modBase は Host が EVT_LIFECYCLE_INIT 時に設定するランタイム値です。
 * 例: `${Ubi.modBase}/templates/manifest.json`
 *      → https://cdn.example.com/mods/video-player/v2.1.0/templates/manifest.json
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// --dist-dir=<path> で出力先を上書き可能（デフォルト: dist/mods/）
const distDirArg = process.argv.slice(2).find((a) => a.startsWith('--dist-dir='));
const distModsDir = distDirArg ? join(root, distDirArg.split('=')[1]) : join(root, 'dist', 'mods');

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
 * ではない。実際の enforcement は実行時ゲート + ユーザー承認（ModHostManager）で行われ、
 * 検出漏れ（動的アクセス・完全な分割代入など）は実行時に必ず拾われる。よって過剰申告寄り。
 *
 * capability 名は shared の CAPABILITY_CATALOG と一致させること
 * （packages/shared/src/mod/capability.ts）。
 */
// api: どの Ubi API を使うとこの capability が付くかの人間向けヒント（ドキュメント生成が参照）。
export const CAPABILITY_DETECTORS = [
    { cap: 'net:fetch', api: 'Ubi.fetch', test: (c) => /\bUbi\.fetch\b/.test(c) },
    { cap: 'ui:render', api: 'Ubi.ui.render', test: (c) => /\bUbi\.ui\b/.test(c) },
    { cap: 'ui:toast', api: 'Ubi.ui.showToast', test: (c) => /\.showToast\s*\(/.test(c) },
    // entity / state はどちらも読み書きしうるため read/update を両方申告（over-approx）
    { cap: 'scene:read', api: 'Ubi.entity.get / query, Ubi.state 読み取り', test: (c) => /\bUbi\.(entity|state)\b/.test(c) },
    {
        cap: 'scene:update',
        api: 'Ubi.entity().update/spawn/destroy, Ubi.state.sync 書き込み',
        test: (c) => /\bUbi\.(entity|state)\b/.test(c),
    },
    { cap: 'event:emit', api: 'Ubi.event.emit', test: (c) => /\bUbi\.event\b/.test(c) },
    { cap: 'event:broadcast', api: 'Ubi.event.broadcast', test: (c) => /\.broadcast\s*\(/.test(c) },
    { cap: 'host:message', api: 'Ubi.event.sendToHost', test: (c) => /\.sendToHost\s*\(/.test(c) },
    { cap: 'canvas:draw', api: 'Ubi.canvas.*', test: (c) => /\bUbi\.canvas\b/.test(c) },
    { cap: 'media:control', api: 'Ubi.media.*', test: (c) => /\bUbi\.media\b/.test(c) },
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
// mod.json の自動探索
// ============================================================

function findModJsonFiles(modsDir) {
    const results = [];
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

export async function buildWorker(modJsonPath) {
    const modDir = dirname(modJsonPath);
    const modJson = JSON.parse(readFileSync(modJsonPath, 'utf-8'));

    const modId = modJson.id;
    const modDirName = basename(modDir);
    const version = modJson.version;
    const publicModDir = join(root, 'packages', 'frontend', 'public', 'mods', modDirName);
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
    const versionedComponents = {};

    for (const [componentName, componentEntry] of Object.entries(componentEntries)) {
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

        const entryPath = join(modDir, workerRelPath);
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
            `✅ [${componentType}] /mods/${modDirName}/v${version}/${componentName}/${outFilename}` +
                ` [caps: ${capabilities.join(', ') || 'none'}]`,
        );
    }

    // assets/ をバージョン固定パスにコピー（Worker は Ubi.modBase で参照）
    const assetsSrcDir = join(modDir, 'assets');
    let assetFiles = [];
    if (existsSync(assetsSrcDir)) {
        copyDirRecursive(assetsSrcDir, publicVersionDir);
        copyDirRecursive(assetsSrcDir, distVersionDir);
        assetFiles = listFilesRecursive(assetsSrcDir);
        console.log(`✅ [${modId}] assets → /mods/${modDirName}/v${version}/ (${assetFiles.length} files)`);
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
}

// ============================================================
// エントリーポイント
// ============================================================

/**
 * 全modの index.json を作成する。
 * エディタ等でローカル利用可能modの一覧を取得するために使う。
 * 各エントリは { id, name, version, kinds[] } 形式（mod.json + バージョン付き manifest を集約）。
 */
function writeModIndex(modJsonFiles) {
    const entries = [];
    for (const modJsonPath of modJsonFiles) {
        const modJson = JSON.parse(readFileSync(modJsonPath, 'utf-8'));
        const modId = modJson.id;
        const modDirName = basename(dirname(modJsonPath));
        // Component 型は "modId:componentName" 形式に展開
        const components = modJson.components
            ? Object.keys(modJson.components).map((name) => `${modId}:${name}`)
            : [];
        entries.push({
            id: modId,
            name: modJson.name ?? modId,
            version: modJson.version,
            // dependencies に追加する際の repository path
            repositoryPath: `mods/${modDirName}`,
            components,
        });
    }
    const json = JSON.stringify(entries, null, 2);
    const publicIndexPath = join(root, 'packages', 'frontend', 'public', 'mods', 'index.json');
    const distIndexPath = join(distModsDir, 'index.json');
    writeFileSync(publicIndexPath, json, 'utf-8');
    writeFileSync(distIndexPath, json, 'utf-8');
    console.log(`📋 mod index: ${entries.length} entries → public/mods/index.json, dist/mods/index.json`);
}

async function main() {
    console.log('🔨 Building mod workers...');
    const modsDir = join(root, 'mods');
    const modJsonFiles = findModJsonFiles(modsDir);

    if (modJsonFiles.length === 0) {
        console.warn('⚠️  mod.json が見つかりません');
        return;
    }

    for (const modJsonPath of modJsonFiles) {
        await buildWorker(modJsonPath);
    }

    writeModIndex(modJsonFiles);

    console.log('🎉 All workers built.');
    console.log(`📦 CDN 配布用: dist/mods/`);
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
