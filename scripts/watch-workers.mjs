/**
 * watch-workers.mjs
 *
 * plugins/*/worker/src 以下のファイル変更を監視し、
 * 変更があった場合に該当プラグインのワーカーのみ再ビルドします。
 */

import { existsSync, readFileSync, readdirSync, watch } from 'node:fs';
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

console.log('[workers] 👀 Watching worker sources...');

for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginJsonPath = join(pluginsDir, entry.name, 'plugin.json');
    if (!existsSync(pluginJsonPath)) continue;

    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    if (!pluginJson.entry?.worker) continue;

    const workerSrcDir = join(pluginsDir, entry.name, 'worker', 'src');
    if (!existsSync(workerSrcDir)) continue;

    const pluginId = pluginJson.id;

    watch(workerSrcDir, { recursive: true }, () => {
        scheduleRebuild(pluginJsonPath, pluginId);
    });

    console.log(`[workers]   watching ${entry.name}/worker/src`);
}
