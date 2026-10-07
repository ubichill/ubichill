/**
 * Sandbox Worker に付ける CSP。Worker の CSP はページではなく Worker スクリプト自身のレスポンスヘッダで決まる。
 *
 * - 通信・フォント・入れ子の Worker を禁じ、スクリプトは同一オリジンだけにする（`import()` の外部読み込みを塞ぐ）。
 * - `'unsafe-eval'` は mod コードの評価に要る。文字列からのコード生成は Worker 内の封鎖が別に塞ぐ。
 * - `'wasm-unsafe-eval'` は WASM のコンパイル用（`'unsafe-eval'` を外しても WASM が動くように明示する）。
 */
export const SANDBOX_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'";

/** パス（クエリを除く）が Sandbox Worker のスクリプトか。dev のソース（.ts）と本番のハッシュ付き .js の両方を見る。 */
export function isSandboxWorkerScriptPath(pathname: string): boolean {
    return /(?:^|\/)sandbox\.worker(?:-[\w-]+)?\.(?:js|ts)$/.test(pathname);
}
