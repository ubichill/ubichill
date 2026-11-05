/**
 * frontend のビルド出力のうち、`world.html` が使うファイル（Vite の manifest から辿れる chunk と CSS、アイコン）。
 * `@ubichill/cli` の公開物に同梱する（build.mjs）のと、SNS のコードが混ざっていないかの検査（scripts/check-world-app-bundle.mjs）で使う。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** manifest のエントリから imports / dynamicImports で辿れる chunk（manifest のキー）。 */
export function reachableChunks(manifest, entry) {
    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
        const key = queue.shift();
        const chunk = manifest[key];
        if (!chunk || seen.has(key)) continue;
        seen.add(key);
        queue.push(...(chunk.imports ?? []), ...(chunk.dynamicImports ?? []));
    }
    return [...seen];
}

/**
 * Sandbox Worker の chunk（`new Worker(new URL(...))` で Vite が別に出すもの）。manifest の import の連鎖には現れないので
 * `assets/` の名前で拾う（@ubichill/shared の isSandboxWorkerScriptPath と同じ形）。
 */
export function workerScripts(distDir) {
    return readdirSync(join(distDir, 'assets'))
        .filter((name) => /^sandbox\.worker(?:-[\w-]+)?\.js$/.test(name))
        .map((name) => `assets/${name}`);
}

/** `world.html` が読む JS（dist からの相対パス）: manifest から辿れる chunk と Sandbox Worker。 */
export function worldScripts(manifest, distDir) {
    return [...reachableChunks(manifest, 'world.html').map((key) => manifest[key].file), ...workerScripts(distDir)];
}

/** `world.html` の公開物（dist からの相対パス）: HTML・JS・CSS・アイコン。 */
export function worldDistFiles(distDir) {
    const manifest = JSON.parse(readFileSync(join(distDir, '.vite', 'manifest.json'), 'utf-8'));
    if (!manifest['world.html']) throw new Error(`${distDir} の manifest に world.html がありません`);
    const css = reachableChunks(manifest, 'world.html').flatMap((key) => manifest[key].css ?? []);
    return ['world.html', 'icon.png', ...worldScripts(manifest, distDir), ...new Set(css)];
}
