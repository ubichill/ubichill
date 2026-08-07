/**
 * watch-workers.mjs
 *
 * mods/＊/src 以下のファイル変更を監視し、
 * 変更があった場合に該当modのワーカーのみ再ビルドします。
 */

import { existsSync, readFileSync, readdirSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMod } from '../packages/sdk/cli/build.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const modsDir = join(root, 'mods');

// デバウンス: 連続変更時に過剰リビルドを防ぐ
const DEBOUNCE_MS = 300;
const timers = new Map();

function scheduleRebuild(modDir, modId) {
    if (timers.has(modId)) clearTimeout(timers.get(modId));
    timers.set(
        modId,
        setTimeout(async () => {
            timers.delete(modId);
            console.log(`[workers] 🔄 ${modId} changed, rebuilding...`);
            try {
                const modDistDir = join(root, 'dist', 'mods', modId);
                const modPublicDir = join(root, 'packages', 'frontend', 'public', 'mods', modId);
                await buildMod(modDir, {
                    distDir: modDistDir,
                    publicDir: modPublicDir,
                });
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
    const modDir = join(modsDir, entry.name);
    const pkgJsonPath = join(modDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const modId = pkg.ubichill?.id ?? pkg.name?.replace(/^@ubichill\/(?:mod-)?/, '') ?? entry.name;

    // 監視対象: src/ ディレクトリ
    const srcDir = join(modDir, 'src');
    if (!existsSync(srcDir)) continue;

    watchRecursive(srcDir, () => {
        scheduleRebuild(modDir, modId);
    });

    // package.json 変更も監視（version/id の変更を検知）
    watch(pkgJsonPath, () => {
        scheduleRebuild(modDir, modId);
    });

    console.log(`[workers]   watching ${entry.name}/src + package.json`);
}
