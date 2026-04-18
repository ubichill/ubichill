/**
 * watch-workers.mjs
 *
 * plugins/＊/worker/src 以下のファイル変更を監視し、
 * 変更があった場合に該当プラグインのワーカーのみ再ビルドします。
 */

import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorker } from './build-workers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pluginsDir = join(root, 'plugins');

// デバウンス: 連続変更時に過剰リビルドを防ぐ
const DEBOUNCE_MS = 300;
const timers = new Map();

function scheduleRebuild(pluginJsonPath, pluginId) {
    if (timers.has(pluginId)) clearTimeout(timers.get(pluginId));
    timers.set(
        pluginId,
        setTimeout(async () => {
            timers.delete(pluginId);
            console.log(`[workers] 🔄 ${pluginId} changed, rebuilding...`);
            try {
                await buildWorker(pluginJsonPath);
                console.log(`[workers] ✅ ${pluginId} rebuilt`);
            } catch (err) {
                console.error(`[workers] ❌ ${pluginId} build failed:`, err.message);
            }
        }, DEBOUNCE_MS),
    );
}

/**
 * `fs.watch` の `recursive` オプションは macOS / Windows のみサポート。
 * Linux では対象ディレクトリを再帰的に列挙して個別に watch する。
 */
function watchRecursive(dir, callback) {
    try {
        watch(dir, { recursive: true }, callback);
    } catch {
        // Linux fallback: ディレクトリツリーを個別に監視
        watch(dir, callback);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                watchRecursive(join(dir, entry.name), callback);
            }
        }
    }
}

console.log('[workers] 👀 Watching worker sources...');

for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginJsonPath = join(pluginsDir, entry.name, 'plugin.json');
    if (!existsSync(pluginJsonPath)) continue;

    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    const pluginId = pluginJson.id;

    // 監視対象のディレクトリを収集（重複排除）
    const watchDirs = new Set();

    // ── 単一エントリ形式: entry.worker ──
    if (pluginJson.entry?.worker) {
        const workerSrcDir = join(pluginsDir, entry.name, 'worker', 'src');
        if (existsSync(workerSrcDir)) watchDirs.add(workerSrcDir);
    }

    // ── 複数エントリ形式: workers ──
    if (pluginJson.workers && typeof pluginJson.workers === 'object') {
        for (const workerEntry of Object.values(pluginJson.workers)) {
            const workerRelPath = typeof workerEntry === 'string' ? workerEntry : workerEntry?.src;
            if (!workerRelPath) continue;
            // src のディレクトリ部分を監視対象に追加
            const srcFile = join(pluginsDir, entry.name, workerRelPath);
            const srcDir = srcFile.includes('/src/') || srcFile.includes('\\src\\')
                ? srcFile.substring(0, srcFile.lastIndexOf('/src/') + 4).replace(/\\/g, '/')
                : dirname(srcFile);
            // プラグインディレクトリ配下の src/ を監視
            const pluginSrcDir = join(pluginsDir, entry.name, 'src');
            if (existsSync(pluginSrcDir)) watchDirs.add(pluginSrcDir);
        }
    }

    if (watchDirs.size === 0) continue;

    for (const watchDir of watchDirs) {
        watchRecursive(watchDir, () => {
            scheduleRebuild(pluginJsonPath, pluginId);
        });
        const relDir = watchDir.replace(pluginsDir + '/', '');
        console.log(`[workers]   watching ${relDir}`);
    }
}
