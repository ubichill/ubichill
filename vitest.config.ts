import { defineConfig } from 'vitest/config';

/**
 * ワークスペース全体のテスト設定。
 * 各パッケージの src 配下 `*.test.ts` を対象にする（純粋ロジック中心なので node 環境）。
 * ワークスペースの `@ubichill/*` 参照は各 tsconfig の paths と同じくソースへ解決する。
 */
export default defineConfig({
    resolve: {
        alias: {
            '@ubichill/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
            '@ubichill/engine': new URL('./packages/engine/src/index.ts', import.meta.url).pathname,
            '@ubichill/sdk': new URL('./packages/sdk/src/index.ts', import.meta.url).pathname,
        },
    },
    test: {
        environment: 'node',
        include: ['packages/**/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
        exclude: ['**/node_modules/**', '**/dist/**'],
    },
});
