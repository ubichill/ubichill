/**
 * `ubichill lock` は非推奨。`ubichill install` に改名された（意味は同じ:
 * ワールド依存を解決し mod 完全性ロックを生成する）。既存の外部ワールド配布スクリプトを
 * 壊さないためだけに残す薄いエイリアス。
 */
import { runInstall } from '@ubichill/loader/install-dependencies';

export async function runLock(argv: string[]): Promise<void> {
    console.warn('⚠️  ubichill lock は非推奨です。ubichill install を使ってください。');
    await runInstall(argv);
}
