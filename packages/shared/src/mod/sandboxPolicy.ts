/**
 * Sandbox Worker に付ける CSP。Worker の CSP はページではなく Worker スクリプト自身のレスポンスヘッダで決まる。
 *
 * - 本番の Worker は 1 ファイルに束ねられ他のスクリプトを読まないので、URL は 1 つも許可しない。
 *   同一オリジンの JS（mod のアセット等）も `import()` で読めず、lock で固定したコードだけが動く。
 * - `'unsafe-eval'` は mod コードの評価に要る。文字列からのコード生成は Worker 内の封鎖が別に塞ぐ。
 * - `'wasm-unsafe-eval'` は WASM のコンパイル用（`'unsafe-eval'` を外しても WASM が動くように明示する）。
 */
const EVAL_SOURCES = "'unsafe-eval' 'wasm-unsafe-eval'";

export const SANDBOX_WORKER_CSP = `default-src 'none'; script-src ${EVAL_SOURCES}`;

/**
 * dev サーバー用。Vite は Worker の依存をモジュールごとに配信するため、それらのパスだけを許可する。
 * `scriptSources` は `http://localhost:3000/@fs/…/packages/sdk/` のようなパス付きのソース。
 */
export function sandboxWorkerDevCsp(scriptSources: readonly string[]): string {
    return `default-src 'none'; script-src ${[...scriptSources, EVAL_SOURCES].join(' ')}`;
}

/** パス（クエリを除く）が Sandbox Worker のスクリプトか。dev のソース（.ts）と本番のハッシュ付き .js の両方を見る。 */
export function isSandboxWorkerScriptPath(pathname: string): boolean {
    return /(?:^|\/)sandbox\.worker(?:-[\w-]+)?\.(?:js|ts)$/.test(pathname);
}
