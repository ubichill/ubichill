/**
 * build-workers.mjs
 *
 * plugins/ 以下の plugin.json を自動探索し、Worker コードを esbuild でバンドルします。
 *
 * plugin.json の workers フィールドを読み取り、Worker コードをバンドルします。
 *
 * ── 単一エントリ形式（後方互換） ──────────────────────────────
 * "entry": { "worker": "./src/worker.ts" }
 *
 * 出力物 (プラグインディレクトリ名を <name> とする):
 *   dist/plugins/<name>/v<version>/index.js
 *   dist/plugins/<name>/v<version>/plugin.json
 *   public/plugins/<name>/v<version>/index.js
 *   public/plugins/<name>/index.js   (バージョン非依存エイリアス)
 *   public/plugins/<name>/plugin.json
 *
 * ── 複数エントリ形式 ──────────────────────────────────────────
 * "workers": { "pen": "./src/worker.ts", "tray": "./src/tray.worker.tsx" }
 *
 * 出力物 (エントリキーを <worker> とする):
 *   dist/plugins/<name>/v<version>/<worker>/index.js
 *   dist/plugins/<name>/v<version>/plugin.json
 *   public/plugins/<name>/<worker>/index.js
 *   public/plugins/<name>/plugin.json
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

async function bundleWorker(entryPath, tsconfig) {
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
    const distVersionDir = join(distPluginsDir, pluginDirName, `v${version}`);

    // tsconfig 検索
    const rootTsconfig = join(pluginDir, 'tsconfig.json');
    const workerTsconfig = join(pluginDir, 'worker', 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : existsSync(workerTsconfig) ? workerTsconfig : undefined;

    // plugin.json をコピー（バージョン固定 + エイリアス）
    mkdirSync(distVersionDir, { recursive: true });
    mkdirSync(publicPluginDir, { recursive: true });
    writeFileSync(join(distVersionDir, 'plugin.json'), pluginJsonContent, 'utf-8');
    writeFileSync(join(publicPluginDir, 'plugin.json'), pluginJsonContent, 'utf-8');

    // ── 単一エントリ形式: entry.worker ────────────────────────
    const singleEntry = pluginJson.entry?.worker;
    if (singleEntry) {
        const entryPath = join(pluginDir, singleEntry);
        if (!existsSync(entryPath)) {
            console.error(`❌ [${pluginId}] entry.worker が見つかりません: ${entryPath}`);
            return;
        }
        const code = await bundleWorker(entryPath, tsconfig);

        // dist: バージョン固定
        writeFileSync(join(distVersionDir, 'index.js'), code, 'utf-8');
        // public: バージョン固定 + エイリアス
        const publicVersionDir = join(publicPluginDir, `v${version}`);
        mkdirSync(publicVersionDir, { recursive: true });
        writeFileSync(join(publicVersionDir, 'index.js'), code, 'utf-8');
        writeFileSync(join(publicVersionDir, 'plugin.json'), pluginJsonContent, 'utf-8');
        writeFileSync(join(publicPluginDir, 'index.js'), code, 'utf-8');
        console.log(`✅ [${pluginId}] /plugins/${pluginDirName}/v${version}/index.js`);
    }

    // ── 複数エントリ形式: workers ──────────────────────────────
    const multiEntries = pluginJson.workers;
    if (multiEntries && typeof multiEntries === 'object') {
        for (const [workerKey, workerEntry] of Object.entries(multiEntries)) {
            // 文字列（旧形式）またはオブジェクト { src, ... }（新形式）の両方に対応
            const workerRelPath = typeof workerEntry === 'string' ? workerEntry : workerEntry?.src;
            if (!workerRelPath) {
                console.error(`❌ [${pluginId}:${workerKey}] src が指定されていません`);
                continue;
            }
            const entryPath = join(pluginDir, workerRelPath);
            if (!existsSync(entryPath)) {
                console.error(`❌ [${pluginId}:${workerKey}] エントリが見つかりません: ${entryPath}`);
                continue;
            }
            const code = await bundleWorker(entryPath, tsconfig);
            const workerLabel = `${pluginId}:${workerKey}`;

            // dist: バージョン固定
            const distWorkerDir = join(distVersionDir, workerKey);
            mkdirSync(distWorkerDir, { recursive: true });
            writeFileSync(join(distWorkerDir, 'index.js'), code, 'utf-8');

            // public: バージョン固定パス（CDNキャッシュバスティング用）
            const publicVersionedWorkerDir = join(publicPluginDir, `v${version}`, workerKey);
            mkdirSync(publicVersionedWorkerDir, { recursive: true });
            writeFileSync(join(publicVersionedWorkerDir, 'index.js'), code, 'utf-8');
            console.log(`✅ [${workerLabel}] /plugins/${pluginDirName}/v${version}/${workerKey}/index.js`);
        }
    }

    if (!singleEntry && !multiEntries) {
        return; // worker なしプラグインはスキップ
    }

    // --- assets/ → public/plugins/<name>/ ---
    const assetsDir = join(pluginDir, 'assets');
    if (existsSync(assetsDir)) {
        copyDirRecursive(assetsDir, publicPluginDir);
        console.log(`✅ [${pluginId}] assets → /plugins/${pluginDirName}/`);
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
