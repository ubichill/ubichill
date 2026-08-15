/**
 * ワールド YAML の依存を解決し mod 完全性ロックを生成する（`ubichill install`）。
 * 実体は `@ubichill/loader` の installDependencies（frontend の buildWorldLock 呼び出しと共有）。
 */
export { runInstall } from '@ubichill/loader/install-dependencies';
