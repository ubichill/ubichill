/**
 * build-workers.mjs
 *
 * plugins/ 以下の plugin.json を自動探索し、Worker コードを esbuild でバンドルします。
 *
 * plugin.json の entities フィールド（entity-first 形式）を読み取り、Worker をバンドルします。
 * エンティティキーは "<pluginId>:<entityKey>" 形式（例: "avatar:cursor"）。
 *
 * 出力物 (プラグインディレクトリ名を <name>、エンティティキーを <key> とする):
 *   dist/plugins/<name>/v<version>/<key>/index.js
 *   dist/plugins/<name>/v<version>/plugin.json
 *   public/plugins/<name>/v<version>/<key>/index.js
 *   public/plugins/<name>/v<version>/plugin.json
 *   public/plugins/<name>/v<version>/  ← assets/ もここにコピー（バージョン固定）
 *   public/plugins/<name>/plugin.json  ← ローダー用エイリアス（最新バージョン）
 *
 * Worker コード内では Ubi.pluginBase でバージョン付きアセットベースパスを参照できます。
 * Ubi.pluginBase は Host が EVT_LIFECYCLE_INIT 時に設定するランタイム値です。
 * 例: `${Ubi.pluginBase}/templates/manifest.json`
 *      → https://cdn.example.com/plugins/avatar/v1.0.0/templates/manifest.json
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

    // ── entities 形式 (entity-first) ────────────────────────────
    const entityEntries = pluginJson.entities;
    if (!entityEntries || typeof entityEntries !== 'object') {
        console.warn(`⚠️  [${pluginId}] entities フィールドが見つかりません。スキップします。`);
        return;
    }

    // バージョン付きマニフェスト用エンティティ（src 除去・workerUrl 追加）
    const versionedEntities = {};

    for (const [entityType, entityEntry] of Object.entries(entityEntries)) {
        const workerRelPath = typeof entityEntry === 'string' ? entityEntry : entityEntry?.src;
        if (!workerRelPath) {
            // src なし = データエンティティ。worker をビルドせず manifest にメタだけ記録する。
            const meta = typeof entityEntry === 'string' ? {} : entityEntry;
            versionedEntities[entityType] = { ...meta };
            console.log(`📋 [${entityType}] data-only (no worker)`);
            continue;
        }

        // "avatar:cursor" → "cursor"
        const colonIdx = entityType.indexOf(':');
        const entityKey = colonIdx !== -1 ? entityType.slice(colonIdx + 1) : entityType;

        const entryPath = join(pluginDir, workerRelPath);
        if (!existsSync(entryPath)) {
            console.error(`❌ [${entityType}] エントリが見つかりません: ${entryPath}`);
            continue;
        }

        const code = await bundleWorker(entryPath, tsconfig, {});

        // コンテンツハッシュ（8文字）でキャッシュバスティング
        const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
        const outFilename = `index.${hash}.js`;

        // dist: バージョン固定
        const distEntityDir = join(distVersionDir, entityKey);
        mkdirSync(distEntityDir, { recursive: true });
        writeFileSync(join(distEntityDir, outFilename), code, 'utf-8');

        // public: バージョン固定パス（CDN キャッシュバスティング用）
        const publicEntityDir = join(publicVersionDir, entityKey);
        mkdirSync(publicEntityDir, { recursive: true });
        writeFileSync(join(publicEntityDir, outFilename), code, 'utf-8');

        // workerUrl を明示、src（ビルド時のみ）は除去
        const { src: _src, ...runtimeMeta } = typeof entityEntry === 'string' ? {} : entityEntry;
        versionedEntities[entityType] = { ...runtimeMeta, workerUrl: `./${entityKey}/${outFilename}` };

        console.log(`✅ [${entityType}] /plugins/${pluginDirName}/v${version}/${entityKey}/${outFilename}`);
    }

    // バージョン付きマニフェストを書き出す（ランタイム用・src なし）
    const versionedManifest = JSON.stringify(
        { id: pluginId, name: pluginJson.name, version, entities: versionedEntities },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'manifest.json'), versionedManifest, 'utf-8');
    writeFileSync(join(publicVersionDir, 'manifest.json'), versionedManifest, 'utf-8');

    // --- assets/ → public/plugins/<name>/v<version>/ ---
    // バージョン付きパスにのみコピーすることでキャッシュバスティングを保証する。
    // Worker コード内では __PLUGIN_BASE__ を使って参照すること。
    const assetsDir = join(pluginDir, 'assets');
    if (existsSync(assetsDir)) {
        copyDirRecursive(assetsDir, publicVersionDir);
        console.log(`✅ [${pluginId}] assets → /plugins/${pluginDirName}/v${version}/`);
    }
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
        const kinds = pluginJson.entities ? Object.keys(pluginJson.entities) : [];
        entries.push({
            id: pluginId,
            name: pluginJson.name ?? pluginId,
            version: pluginJson.version,
            // dependencies に追加する際の repository path
            repositoryPath: `plugins/${pluginDirName}`,
            kinds,
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

main().catch((err) => {
    console.error('❌ Worker build failed:', err);
    process.exit(1);
});
