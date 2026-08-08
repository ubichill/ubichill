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

function readModId(modDir, fallback) {
    const pkg = JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf-8'));
    return pkg.ubichill?.id ?? pkg.name?.replace(/^@ubichill\/(?:mod-)?/, '') ?? fallback;
}

function scheduleRebuild(modDir, entryName) {
    if (timers.has(modDir)) clearTimeout(timers.get(modDir));
    timers.set(
        modDir,
        setTimeout(async () => {
            timers.delete(modDir);
            // package.json は変更されている可能性があるため再読込する（version/id 変更を反映）
            const modId = readModId(modDir, entryName);
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

    // 監視対象: src/ ディレクトリ
    const srcDir = join(modDir, 'src');
    if (!existsSync(srcDir)) continue;

    watchRecursive(srcDir, () => {
        scheduleRebuild(modDir, entry.name);
    });

    // package.json 変更も監視（version/id の変更を検知。rebuild 時に再読込する）
    watch(pkgJsonPath, () => {
        scheduleRebuild(modDir, entry.name);
    });

    console.log(`[workers]   watching ${entry.name}/src + package.json`);
}
