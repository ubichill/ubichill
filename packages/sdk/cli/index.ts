#!/usr/bin/env node
/**
 * `ubichill` CLI（mod開発者向け）。サブコマンドで build/install/update/verify を振り分ける。
 *
 * 使い方:
 *   ubichill build   [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>]
 *   ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]
 *   ubichill update  <world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>]
 *   ubichill verify  [--dist-dir=<dir>]
 *
 * `lock` は `install` の旧名。非推奨だが後方互換のため残る。
 *
 * このリポジトリ内部からは `node packages/sdk/cli/index.ts <subcommand> ...` で直接実行できる
 * （Node 22+ の TypeScript 型ストリッピングにより tsx 等は不要。相対importは全て拡張子明示
 * にしているため Node ネイティブの ESM 解決でも問題なく辿れる）。公開パッケージ `ubichill` では
 * `packages/sdk/build.mjs` がこのファイルを esbuild で自己完結バンドルし、`bin` として配布する。
 */
import { runBuild } from './build.ts';
import { runInstall } from './install.ts';
import { runLock } from './lock.ts';
import { runUpdate } from './update.ts';
import { runVerify } from './verify.ts';

const USAGE = `使い方: ubichill <build|install|update|verify> [...args]`;

async function main(): Promise<void> {
    const [subcommand, ...rest] = process.argv.slice(2);
    switch (subcommand) {
        case 'build':
            await runBuild(rest);
            return;
        case 'install':
            await runInstall(rest);
            return;
        case 'update':
            await runUpdate(rest);
            return;
        case 'lock': // 非推奨エイリアス
            await runLock(rest);
            return;
        case 'verify':
            await runVerify(rest);
            return;
        default:
            console.error(USAGE);
            process.exit(1);
    }
}

main().catch((err) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
