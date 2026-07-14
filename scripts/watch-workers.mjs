/**
 * watch-workers.mjs
 *
 * mods/＊/worker/src 以下のファイル変更を監視し、
 * 変更があった場合に該当modのワーカーのみ再ビルドします。
 */

import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorker } from './build-workers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const modsDir = join(root, 'mods');

// デバウンス: 連続変更時に過剰リビルドを防ぐ
const DEBOUNCE_MS = 300;
const timers = new Map();

function scheduleRebuild(modJsonPath, modId) {
    if (timers.has(modId)) clearTimeout(timers.get(modId));
    timers.set(
        modId,
        setTimeout(async () => {
            timers.delete(modId);
            console.log(`[workers] 🔄 ${modId} changed, rebuilding...`);
            try {
                await buildWorker(modJsonPath);
                console.log(`[workers] ✅ ${modId} rebuilt`);
            } catch (err) {
                console.error(`[workers] ❌ ${modId} build failed:`, err.message);
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

for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modJsonPath = join(modsDir, entry.name, 'mod.json');
    if (!existsSync(modJsonPath)) continue;

    const modJson = JSON.parse(readFileSync(modJsonPath, 'utf-8'));
    const modId = modJson.id;

    // 監視対象のディレクトリを収集（重複排除）
    const watchDirs = new Set();

    // ── 単一エントリ形式: entry.worker ──
    if (modJson.entry?.worker) {
        const workerSrcDir = join(modsDir, entry.name, 'worker', 'src');
        if (existsSync(workerSrcDir)) watchDirs.add(workerSrcDir);
    }

    // ── 複数エントリ形式: workers ──
    if (modJson.workers && typeof modJson.workers === 'object') {
        for (const workerEntry of Object.values(modJson.workers)) {
            const workerRelPath = typeof workerEntry === 'string' ? workerEntry : workerEntry?.src;
            if (!workerRelPath) continue;
            // src のディレクトリ部分を監視対象に追加
            const srcFile = join(modsDir, entry.name, workerRelPath);
            const srcDir = srcFile.includes('/src/') || srcFile.includes('\\src\\')
                ? srcFile.substring(0, srcFile.lastIndexOf('/src/') + 4).replace(/\\/g, '/')
                : dirname(srcFile);
            // modディレクトリ配下の src/ を監視
            const modSrcDir = join(modsDir, entry.name, 'src');
            if (existsSync(modSrcDir)) watchDirs.add(modSrcDir);
        }
    }

    if (watchDirs.size === 0) continue;

    for (const watchDir of watchDirs) {
        watchRecursive(watchDir, () => {
            scheduleRebuild(modJsonPath, modId);
        });
        const relDir = watchDir.replace(modsDir + '/', '');
        console.log(`[workers]   watching ${relDir}`);
    }
}
