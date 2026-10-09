#!/usr/bin/env node
/**
 * `ubichill` CLI（mod開発者向け）。サブコマンドで build/install/update/verify を振り分ける。
 *
 * 使い方:
 *   ubichill build   [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>]
 *   ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>] [--check]
 *   ubichill update  <world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>]
 *   ubichill verify  [--dist-dir=<dir>] [--require-signatures]   mod のビルド（lock.json と署名）を検証する
 *   ubichill verify  <world.yaml>            ワールドの署名が今の内容に対して有効か調べる
 *   ubichill login   [--server=<url>] [--device] [--name=<表示名>] [--no-browser]
 *   ubichill logout  [--server=<url>]
 *   ubichill whoami  [--server=<url>]
 *   ubichill ci create --name=<表示名> [--server=<url>] [--device]
 *   ubichill publish <world.yaml>... [--server=<url>] [--out=<dir>] [--no-install]
 *   ubichill publish <mods のビルド出力>...   mod の配布物（例 dist/mods）に署名する
 *
 * `login` はブラウザで承認してこの端末を公開環境にする（鍵は手元だけ）。`publish` はログインしたアカウントで署名して公開する。
 * CI は `ci create` で作った文字列を env UBICHILL_CREDENTIALS に入れて `publish` する。鍵は CLI が作って手元に持つ
 * （鍵ファイルを自分で作って管理する `keygen` / `sign` は廃止。自分のドメインの作者アカウント #181 で必要になれば作り直す）。
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
import { runVerify } from './verify.ts';
import { runVerifyWorld } from './verifyWorld.ts';

const USAGE = `使い方: ubichill <login|logout|whoami|publish|ci create|build|install|update|verify> [...args]`;

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
            // <world.yaml> を渡したらワールドの署名、無ければ mod のビルド
            if (rest.some((a) => !a.startsWith('--') && /\.ya?ml$/i.test(a))) await runVerifyWorld(rest);
            else await runVerify(rest);
            return;
        case 'keygen':
        case 'sign':
            console.error(
                `ubichill ${subcommand} は廃止しました。署名は ubichill login（CI は ubichill ci create）のあと ubichill publish で行います。署名の確認は ubichill verify <world.yaml> です。`,
            );
            process.exit(1);
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
