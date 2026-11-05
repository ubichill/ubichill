/**
 * `world.html` とその assets の置き場所。
 * 1. 環境変数 `UBICHILL_WORLD_DIST`
 * 2. 公開物に同梱した `world/`（cli.js の隣）
 * 3. このリポジトリの中で動かしているとき: `packages/frontend/dist-world`（`pnpm --filter @ubichill/frontend build:world`）
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORLD_DIST_ENV = 'UBICHILL_WORLD_DIST';

export function resolveWorldDist(deps: {
    env: Readonly<Record<string, string | undefined>>;
    candidates: readonly string[];
    exists: (path: string) => boolean;
}): { path: string } | { error: string } {
    const fromEnv = deps.env[WORLD_DIST_ENV];
    if (fromEnv) {
        return deps.exists(join(fromEnv, 'world.html'))
            ? { path: fromEnv }
            : { error: `${WORLD_DIST_ENV}=${fromEnv} に world.html がありません` };
    }
    const found = deps.candidates.find((dir) => deps.exists(join(dir, 'world.html')));
    return found
        ? { path: found }
        : {
              error:
                  'world.html が見つかりません。このリポジトリの中なら `pnpm --filter @ubichill/frontend build:world` を実行してください' +
                  `（候補: ${deps.candidates.join(', ')}）`,
          };
}

export function findWorldDist(): { path: string } | { error: string } {
    const here = dirname(fileURLToPath(import.meta.url));
    const fromSource = here.endsWith(join('packages', 'cli', 'src', 'dev'));
    return resolveWorldDist({
        env: process.env,
        candidates: fromSource
            ? [join(here, '..', '..', '..', 'frontend', 'dist-world')]
            : [join(here, 'world'), join(here, '..', 'world')],
        exists: existsSync,
    });
}
