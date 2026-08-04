/**
 * ワールド YAML から mod 完全性ロックを生成する（`ubichill lock`）。
 * 実体は `@ubichill/loader` の genLock（frontend の buildWorldLock 呼び出しと共有）。
 */
export { runGenLock as runLock } from '@ubichill/loader/gen-lock';
