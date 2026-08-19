/**
 * `worlds/*.yaml` 全件について、兄弟 `<world>.lock.json` が現在の mod ビルド
 * （`packages/frontend/public/mods`、先に `pnpm build:workers` 済みが前提）と一致しているかを検証する。
 *
 * mod のソースを変更して再ビルドしても `worlds/*.lock.json` は自動更新されない
 * （`ubichill install <world.yaml>` を手動実行しない限り陳腐化する）。この陳腐化はローカル
 * 開発では console.warn 止まりで動いてしまう（動かないこともある）ため気づきにくく、CI でも
 * 検出されていなかった。ここで fail-closed に倒し、CI で確実に気づけるようにする。
 */
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../packages/sdk/cli/index.ts', import.meta.url));
const modsDir = fileURLToPath(new URL('../packages/frontend/public/mods', import.meta.url));

const worldFiles = globSync('worlds/*.yaml', { cwd: repoRoot });
if (worldFiles.length === 0) {
    console.error('❌ worlds/*.yaml が見つかりません');
    process.exit(1);
}

let failed = false;
for (const relPath of worldFiles.sort()) {
    try {
        execFileSync('node', [cliPath, 'install', relPath, `--mods-dir=${modsDir}`, '--check'], {
            cwd: repoRoot,
            stdio: 'inherit',
        });
    } catch {
        failed = true;
    }
}

process.exit(failed ? 1 : 0);
