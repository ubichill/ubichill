/**
 * @ubichill/sdk/jsx-runtime
 *
 * TypeScript の automatic JSX runtime サポート。
 * プラグインの tsconfig.json に以下を追加するだけで TSX が使える:
 *
 * ```json
 * {
 *   "compilerOptions": {
 *     "jsx": "react-jsx",
 *     "jsxImportSource": "@ubichill/sdk"
 *   }
 * }
 * ```
 *
 * Worker-safe: DOM を一切参照しない。
 */

export type { JSX } from '@ubichill/sandbox/guest/jsx-runtime';
// ファクトリ・型宣言・Fragment をすべて sandbox の実装から re-export する
export { Fragment, jsx, jsxDEV, jsxs } from '@ubichill/sandbox/guest/jsx-runtime';
