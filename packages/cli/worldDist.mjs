/**
 * world.html のビルド出力（`packages/frontend/dist-world`。`pnpm --filter @ubichill/frontend build:world`）。
 * SNS の画面とは別のビルドなので、中のファイルは全部 world.html のためのもの。
 * `@ubichill/cli` の公開物に同梱する（build.mjs）のと、SNS のコードが混ざっていないかの検査（scripts/check-world-app-bundle.mjs）で使う。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORLD_DIST_DIR = fileURLToPath(new URL('../frontend/dist-world', import.meta.url));

/** 出力の中の全ファイル（dist からの POSIX 相対パス、ソート済み）。world.html が無ければ throw。 */
export function worldDistFiles(distDir = WORLD_DIST_DIR) {
    if (!existsSync(join(distDir, 'world.html'))) {
        throw new Error(`${distDir} に world.html がありません（pnpm --filter @ubichill/frontend build:world）`);
    }
    return readdirSync(distDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(distDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .sort();
}

/** world.html の出力に置いてよいファイル: HTML・アイコン・assets/ の下（public/ の SNS の配信物が混ざらないこと）。 */
export const isWorldDistFile = (file) => file === 'world.html' || file === 'icon.png' || file.startsWith('assets/');
