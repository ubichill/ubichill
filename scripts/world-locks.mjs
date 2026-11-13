/**
 * `worlds/*.yaml` 全件の mod 完全性ロック（兄弟 `<world>.lock.json`）を、現在の mod ビルド
 * （`packages/frontend/public/mods`、先に `pnpm build:workers` 済みが前提）から再生成する。
 * 公式ワールドは同じリポジトリの mod と一緒に出すので、`ubichill update` でリポジトリの今の版に上げて YAML に固定する
 * （mod の版を上げた PR では、公式ワールドの版の変更も差分に出る）。
 * `--check` 付きなら書き込まず、版が固定されていて既存ファイルと一致するかだけ検証して不一致なら非ゼロ終了する（CI 用の drift 検出）。
 *
 * `worlds/*.lock.json` はコミットされる、レビュー可能な固定ピン（`pnpm-lock.yaml` と同じ位置づけ）。
 * 署名（`.sig.json`）はリポジトリに置かない。main に入ったら CI が公式アカウントの公開環境（Secret UBICHILL_CREDENTIALS）で
 * `ubichill publish worlds/*.yaml --out=worlds` して、イメージに同梱する（マージ = 公式としての確認。ほかの作者の CI と同じ方法）。
 */
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTerminal, debugFromEnv, processIO } from '@ubichill/terminal';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../packages/cli/src/index.ts', import.meta.url));
const modsDir = fileURLToPath(new URL('../packages/frontend/public/mods', import.meta.url));
const check = process.argv.includes('--check');

const worldFiles = globSync('worlds/*.yaml', { cwd: repoRoot });
if (worldFiles.length === 0) {
    createTerminal(processIO(), { debug: debugFromEnv(process.env) }).error('worlds/*.yaml が見つかりません');
    process.exit(1);
}

const run = (args) => {
    try {
        execFileSync('node', [cliPath, ...args], { cwd: repoRoot, stdio: 'inherit' });
        return true;
    } catch {
        return false;
    }
};

// 1 つ失敗しても残りのワールドも確かめる（map は途中で止まらない）
const results = worldFiles
    .sort()
    .map((relPath) =>
        run(check ? ['install', relPath, `--mods-dir=${modsDir}`, '--check'] : ['update', relPath, `--mods-dir=${modsDir}`]),
    );

process.exit(results.every(Boolean) ? 0 : 1);
