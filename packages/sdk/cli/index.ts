#!/usr/bin/env node
/**
 * `ubichill` CLI（mod開発者向け）。サブコマンドで build/install/update/verify を振り分ける。
 *
 * 使い方:
 *   ubichill build   [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>]
 *   ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>] [--no-sign] [--key-file=<path>]
 *   ubichill update  <world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>]
 *   ubichill verify  [--dist-dir=<dir>]
 *   ubichill keygen  [--out=<path>]
 *   ubichill sign    <world.yaml> [--key-file=<path>] [--author=handle@domain] [--out=<path>] [--check]
 *   ubichill login   [--server=<url>] [--device] [--name=<表示名>] [--no-browser]
 *   ubichill logout  [--server=<url>]
 *   ubichill whoami  [--server=<url>]
 *   ubichill ci create --name=<表示名> [--server=<url>] [--device]
 *   ubichill publish <world.yaml>... [--server=<url>] [--out=<dir>] [--no-install]
 *
 * `login` はブラウザで承認してこの端末を公開環境にする（鍵は手元だけ）。`publish` はログインしたアカウントで署名して公開する。
 * CI は `ci create` で作った文字列を env UBICHILL_CREDENTIALS に入れて `publish` する。`keygen` / `sign` は上級者向け。
 *
 * `lock` は `install` の旧名。非推奨だが後方互換のため残る。
 *
 * このリポジトリ内部からは `node packages/sdk/cli/index.ts <subcommand> ...` で直接実行できる
 * （Node 22+ の TypeScript 型ストリッピングにより tsx 等は不要。相対importは全て拡張子明示
 * にしているため Node ネイティブの ESM 解決でも問題なく辿れる）。公開パッケージ `ubichill` では
 * `packages/sdk/build.mjs` がこのファイルを esbuild で自己完結バンドルし、`bin` として配布する。
 */
import { runCiCreate, runLogin, runLogout, runPublish, runWhoami } from './account.ts';
import { runBuild } from './build.ts';
import { runInstall } from './install.ts';
import { runLock } from './lock.ts';
import { runUpdate } from './update.ts';
import { runKeygen, runSign } from './sign.ts';
import { runVerify } from './verify.ts';

const USAGE = `使い方: ubichill <login|logout|whoami|publish|ci create|build|install|update|verify|keygen|sign> [...args]`;

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
        case 'keygen':
            await runKeygen(rest);
            return;
        case 'sign':
            await runSign(rest);
            return;
        case 'login':
            await runLogin(rest);
            return;
        case 'logout':
            await runLogout(rest);
            return;
        case 'whoami':
            await runWhoami(rest);
            return;
        case 'publish':
            await runPublish(rest);
            return;
        case 'ci':
            if (rest[0] === 'create') {
                await runCiCreate(rest.slice(1));
                return;
            }
            console.error('使い方: ubichill ci create --name=<表示名>');
            process.exit(1);
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
