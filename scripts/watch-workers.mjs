/**
 * watch-workers.mjs
 *
 * mods/＊/src 以下のファイル変更を監視し、
 * 変更があった場合に該当modのワーカーのみ再ビルドします。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerminal, debugFromEnv, formatDuration, messageOf, processIO, remapLevels } from '@ubichill/terminal';
import { buildMod } from '../packages/cli/src/build.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const modsDir = join(root, 'mods');
const worldLocksScript = join(root, 'scripts', 'world-locks.mjs');
// 出どころの [workers] は dev.mjs の concurrently が付ける（ここでも付けると二重になる）
const log = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
// Component ごとの成果物の行は debug に落とし、capability・esbuild の警告は出す
const buildLog = remapLevels(log, { info: 'debug', success: 'debug' });

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
            log.info(`${modId} changed, rebuilding...`);
            const started = performance.now();
            try {
                const modDistDir = join(root, 'dist', 'mods', modId);
                const modPublicDir = join(root, 'packages', 'frontend', 'public', 'mods', modId);
                await buildMod(modDir, {
                    distDir: modDistDir,
                    publicDir: modPublicDir,
                    log: buildLog,
                });
                // Worker URL/integrity changes must become visible atomically with
                // the rebuilt public files. The backend watches these lock files and
                // reloads the corresponding official world definition.
                execFileSync(process.execPath, [worldLocksScript], { cwd: root, stdio: 'inherit' });
                log.success(`${modId} rebuilt; world locks regenerated`, formatDuration(performance.now() - started));
            } catch (err) {
                log.error(`${modId} build failed: ${messageOf(err)}`);
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

const watched = readdirSync(modsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, modDir: join(modsDir, entry.name) }))
    .filter(({ modDir }) => existsSync(join(modDir, 'package.json')) && existsSync(join(modDir, 'src')));

for (const { name, modDir } of watched) {
    // 監視対象: src/ ディレクトリ
    watchRecursive(join(modDir, 'src'), () => scheduleRebuild(modDir, name));
    // package.json 変更も監視（version/id の変更を検知。rebuild 時に再読込する）
    watch(join(modDir, 'package.json'), () => scheduleRebuild(modDir, name));
}

log.info(
    `Watching worker sources of ${watched.length} mods (src + package.json)`,
    watched.map(({ name }) => name).join(', '),
);
