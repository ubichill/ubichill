#!/usr/bin/env node
/**
 * `ubichill` CLI（mod開発者向け）。サブコマンドで build/lock/verify を振り分ける。
 *
 * 使い方:
 *   ubichill build  [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>]
 *   ubichill lock   <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]
 *   ubichill verify [--dist-dir=<dir>]
 *
 * このリポジトリ内部からは `node packages/sdk/cli/index.ts <subcommand> ...` で直接実行できる
 * （Node 22+ の TypeScript 型ストリッピングにより tsx 等は不要。相対importは全て拡張子明示
 * にしているため Node ネイティブの ESM 解決でも問題なく辿れる）。公開パッケージ `ubichill` では
 * `packages/sdk/build.mjs` がこのファイルを esbuild で自己完結バンドルし、`bin` として配布する。
 */
import { runBuild } from './build.ts';
import { runLock } from './lock.ts';
import { runVerify } from './verify.ts';

const USAGE = `使い方: ubichill <build|lock|verify> [...args]`;

async function main(): Promise<void> {
    const [subcommand, ...rest] = process.argv.slice(2);
    switch (subcommand) {
        case 'build':
            await runBuild(rest);
            return;
        case 'lock':
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
