/**
 * `worlds/*.yaml` 全件について mod 完全性ロック（兄弟 `<world>.lock.json`）と作者署名（`<world>.sig.json`）を
 * 保守する。ロックの説明は以下。署名は lock を含む内容に付くため、lock が変わると署名し直しが要る:
 *   - 通常実行: 署名はしない。署名が古くなったら警告のみ（Docker/CI のビルドは鍵を持たない。
 *     lock が変わらなければ署名はそのまま有効）。
 *   - `--sign`（`pnpm sign:worlds`）: 内容を確認したメンテナが明示的に署名する。ビルドのたびに自動署名すると
 *     「確認した」ではなく「手元でビルドした」ことしか意味しなくなるため分けている。
 *     鍵: env UBICHILL_SIGNING_KEY / UBICHILL_SIGNING_KEY_FILE、既定 ~/.config/ubichill/official-worlds.key。
 *   - `--check`: 署名が現在の YAML + lock に対して有効かも検証し、無効なら非ゼロ終了する。
 *
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
import { existsSync, globSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../packages/sdk/cli/index.ts', import.meta.url));
const modsDir = fileURLToPath(new URL('../packages/frontend/public/mods', import.meta.url));
const check = process.argv.includes('--check');
const defaultKeyFile = join(homedir(), '.config', 'ubichill', 'official-worlds.key');
const keyFile = process.env.UBICHILL_SIGNING_KEY_FILE ?? (existsSync(defaultKeyFile) ? defaultKeyFile : undefined);
const sign = process.argv.includes('--sign');
if (sign && !process.env.UBICHILL_SIGNING_KEY && !keyFile) {
    console.error(`❌ 署名鍵がありません（${defaultKeyFile} か env UBICHILL_SIGNING_KEY[_FILE]）`);
    process.exit(1);
}

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
    const installArgs = ['install', relPath, `--mods-dir=${modsDir}`];
    if (check) installArgs.push('--check');
    if (!run(installArgs)) failed = true;

    if (sign) {
        if (!run(['sign', relPath, ...(keyFile ? [`--key-file=${keyFile}`] : [])])) failed = true;
    } else if (!run(['sign', relPath, '--check'])) {
        if (check) {
            failed = true;
        } else {
            console.warn(
                `⚠ ${relPath} の署名が無効です。署名鍵を持つメンテナが内容を確認して \`pnpm sign:worlds\` で署名し直す必要があります（未署名の公式ワールドは一覧に出ません）。`,
            );
        }
    }
}

process.exit(failed ? 1 : 0);
