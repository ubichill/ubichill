/**
 * `worlds/*.yaml` 全件の mod 完全性ロック（兄弟 `<world>.lock.json`）を、現在の mod ビルド
 * （`packages/frontend/public/mods`、先に `pnpm build:workers` 済みが前提）から再生成する。
 * `--check` 付きなら書き込まず、既存ファイルと一致するかだけ検証して不一致なら非ゼロ終了する（CI 用の drift 検出）。
 *
 * `worlds/*.lock.json` はコミットされる、レビュー可能な固定ピン（`pnpm-lock.yaml` と同じ位置づけ）。
 * 署名（`.sig.json`）はリポジトリに置かない。main に入ったら CI が公式アカウントの公開環境（Secret UBICHILL_CREDENTIALS）で
 * `ubichill publish worlds/*.yaml --out=worlds` して、イメージに同梱する（マージ = 公式としての確認。ほかの作者の CI と同じ方法）。
 */
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../packages/sdk/cli/index.ts', import.meta.url));
const modsDir = fileURLToPath(new URL('../packages/frontend/public/mods', import.meta.url));
const check = process.argv.includes('--check');

const worldFiles = globSync('worlds/*.yaml', { cwd: repoRoot });
if (worldFiles.length === 0) {
    console.error('❌ worlds/*.yaml が見つかりません');
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

let failed = false;
for (const relPath of worldFiles.sort()) {
    // 署名は CI が公式アカウントで行うので、install の自動署名は止める。
    const installArgs = ['install', relPath, `--mods-dir=${modsDir}`, '--no-sign'];
    if (check) installArgs.push('--check');
    if (!run(installArgs)) failed = true;
}

process.exit(failed ? 1 : 0);
