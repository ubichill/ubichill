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
    const pluginJsonContent = readFileSync(pluginJsonPath, 'utf-8');

    const publicPluginDir = join(root, 'packages', 'frontend', 'public', 'plugins', pluginDirName);
    const publicVersionDir = join(publicPluginDir, `v${version}`);
    const distVersionDir = join(distPluginsDir, pluginDirName, `v${version}`);

    // tsconfig 検索
    const rootTsconfig = join(pluginDir, 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : undefined;

    // plugin.json をコピー（バージョン固定 + エイリアス）
    mkdirSync(distVersionDir, { recursive: true });
    mkdirSync(publicVersionDir, { recursive: true });
    writeFileSync(join(distVersionDir, 'plugin.json'), pluginJsonContent, 'utf-8');
    writeFileSync(join(publicVersionDir, 'plugin.json'), pluginJsonContent, 'utf-8');
    // publicPluginDir 直下のエイリアス（ローダーが /plugins/<name>/plugin.json で取得する）
    mkdirSync(publicPluginDir, { recursive: true });
    writeFileSync(join(publicPluginDir, 'plugin.json'), pluginJsonContent, 'utf-8');

    // ── entities 形式 (entity-first) ────────────────────────────
    const entityEntries = pluginJson.entities;
    if (!entityEntries || typeof entityEntries !== 'object') {
        console.warn(`⚠️  [${pluginId}] entities フィールドが見つかりません。スキップします。`);
        return;
    }

    for (const [entityType, entityEntry] of Object.entries(entityEntries)) {
        const workerRelPath = typeof entityEntry === 'string' ? entityEntry : entityEntry?.src;
        if (!workerRelPath) {
            console.error(`❌ [${entityType}] src が指定されていません`);
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

        // dist: バージョン固定
        const distEntityDir = join(distVersionDir, entityKey);
        mkdirSync(distEntityDir, { recursive: true });
        writeFileSync(join(distEntityDir, 'index.js'), code, 'utf-8');

        // public: バージョン固定パス（CDN キャッシュバスティング用）
        const publicEntityDir = join(publicVersionDir, entityKey);
        mkdirSync(publicEntityDir, { recursive: true });
        writeFileSync(join(publicEntityDir, 'index.js'), code, 'utf-8');

        console.log(`✅ [${entityType}] /plugins/${pluginDirName}/v${version}/${entityKey}/index.js`);
    }

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

    console.log('🎉 All workers built.');
    console.log(`📦 CDN 配布用: dist/plugins/`);
}

main().catch((err) => {
    console.error('❌ Worker build failed:', err);
    process.exit(1);
});
