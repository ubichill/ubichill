/**
 * Worker 内グローバル型宣言。
 *
 * `Ubi` は sandbox.worker.ts が `new SafeFunction('Ubi', code)` で注入する。
 * import 文を書くとモジュール扱いになってグローバルに効かないため、
 * inline import type を使う。
 */
declare const Ubi: import('@ubichill/sdk').UbiSDK;
/** esbuild が注入するバージョン付きアセットベースパス。例: /plugins/avatar/v1.0.0 */
declare const __PLUGIN_BASE__: string;
