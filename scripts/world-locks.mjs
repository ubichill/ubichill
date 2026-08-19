/**
 * `worlds/*.yaml` 全件について mod 完全性ロック（兄弟 `<world>.lock.json`）を
 * 現在の mod ビルド（`packages/frontend/public/mods`、先に `pnpm build:workers` 済みが前提）
 * から再生成する。`--check` 付きなら書き込まず、既存ファイルと一致するかだけ検証して
 * 不一致なら非ゼロ終了する（CI 用の drift 検出）。
 *
 * `worlds/*.lock.json` はコミットされる、レビュー可能な固定ピン（`pnpm-lock.yaml` と同じ
 * 位置づけ）。`build:workers` の直後に毎回このスクリプト（`--check` 無し）を実行して自動生成
 * することで、「mod を再ビルドしたのに手動 `ubichill install` を忘れて陳腐化する」という
 * 人為ミスのクラスを無くす。生成物は git に committed される前提なので、CI では
 * `--check`（再生成せず一致確認のみ）を実行し、コミットし忘れを検出する
 * （frozen-lockfile チェックと同じパターン）。
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

let failed = false;
for (const relPath of worldFiles.sort()) {
    const args = [cliPath, 'install', relPath, `--mods-dir=${modsDir}`];
    if (check) args.push('--check');
    try {
        execFileSync('node', args, { cwd: repoRoot, stdio: 'inherit' });
    } catch {
        failed = true;
    }
}

process.exit(failed ? 1 : 0);
