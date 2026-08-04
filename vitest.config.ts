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
        // 配列 + 完全一致の正規表現（`^...$`）で指定する。plain object 形式の alias は
        // 実装によっては prefix マッチしてしまい、サブパス（例: @ubichill/shared/mod/protocol）が
        // 意図せず親エイリアス（@ubichill/shared）に食われて壊れるケースがあったため。
        alias: [
            { find: /^@ubichill\/shared$/, replacement: srcPath('./packages/shared/src/index.ts') },
            // shared のサブパスエクスポート（barrel 経由で schemas/* の zod まで読み込むと
            // dts-bundle-generator が極端に遅くなるため、SDK 側は個別サブパスを直接 import する）。
            {
                find: /^@ubichill\/shared\/mod\/entities$/,
                replacement: srcPath('./packages/shared/src/mod/entities.ts'),
            },
            {
                find: /^@ubichill\/shared\/mod\/protocol$/,
                replacement: srcPath('./packages/shared/src/mod/protocol.ts'),
            },
            { find: /^@ubichill\/shared\/mod\/errors$/, replacement: srcPath('./packages/shared/src/mod/errors.ts') },
            { find: /^@ubichill\/shared\/mod\/vnode$/, replacement: srcPath('./packages/shared/src/mod/vnode.ts') },
            { find: /^@ubichill\/shared\/mod\/types$/, replacement: srcPath('./packages/shared/src/mod/types.ts') },
            { find: /^@ubichill\/loader$/, replacement: srcPath('./packages/loader/src/index.ts') },
            {
                find: /^@ubichill\/loader\/gen-lock$/,
                replacement: srcPath('./packages/loader/src/genLock.ts'),
            },
            { find: /^@ubichill\/ecs$/, replacement: srcPath('./packages/ecs/src/index.ts') },
            { find: /^@ubichill\/sdk$/, replacement: srcPath('./packages/sdk/src/index.ts') },
            { find: /^@ubichill\/ui-renderer$/, replacement: srcPath('./packages/ui-renderer/src/index.ts') },
        ],
    },
    test: {
        environment: 'node',
        // packages 配下はどこにテストファイルがあっても拾う（src/ 限定にしない。
        // 例: packages/sdk/build.test.mjs, packages/sdk/cli/build.test.ts はビルドツール自身の
        // テストで src/ 配下ではない）。
        include: ['packages/**/*.test.{ts,tsx,mjs}', 'scripts/**/*.test.mjs'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/dist-npm/**'],
    },
});
