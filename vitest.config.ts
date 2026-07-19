import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * ワークスペース全体のテスト設定。
 * 各パッケージの src 配下 `*.test.ts` を対象にする（純粋ロジック中心なので node 環境）。
 * ワークスペースの `@ubichill/*` 参照は各 tsconfig の paths と同じくソースへ解決する。
 *
 * パス解決は fileURLToPath で行う。`new URL(...).pathname` は Windows で `/C:/...` になり
 * alias 解決が壊れるため使わない（OS 依存を吸収）。
 */
const srcPath = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@ubichill/shared': srcPath('./packages/shared/src/index.ts'),
            '@ubichill/ecs': srcPath('./packages/ecs/src/index.ts'),
            '@ubichill/sdk': srcPath('./packages/sdk/src/index.ts'),
            '@ubichill/ui-renderer': srcPath('./packages/ui-renderer/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['packages/**/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
        exclude: ['**/node_modules/**', '**/dist/**'],
    },
});
