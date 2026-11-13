#!/usr/bin/env node
/**
 * `ubichill` CLI（mod・ワールドの作者向け）。サブコマンドを振り分ける。
 *
 * 使い方:
 *   ubichill init    mod|world <名前>
 *   ubichill build   [--mods-dir=<dir>] [--public-mods-dir=<dir>] [--dist-dir=<dir>] [--registry-url=<url>] [--layout=registry]
 *   ubichill install @<作者>@<サーバー>/<mod>[@<版>] | <作品ページの URL> [--world=<world.yaml>] [--accept-capabilities]
 *   ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>] [--check] [--accept-capabilities]
 *   ubichill update  <world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>] [--accept-capabilities]
 *   ubichill search  <名前> [--server=<url>]
 *   ubichill prefab  add <mod>/<プレハブ> | update <Entity ID> [--apply] | unpack <Entity ID> [--world=<world.yaml>]
 *   ubichill verify  [--dist-dir=<dir>] [--require-signatures]   mod のビルド（lock.json と署名）を検証する
 *   ubichill verify  <world.yaml>            ワールドの署名が今の内容に対して有効か調べる
 *   ubichill login   [--server=<url>] [--device] [--name=<表示名>] [--no-browser]
 *   ubichill logout  [--server=<url>]
 *   ubichill whoami  [--server=<url>]
 *   ubichill ci create --name=<表示名> [--server=<url>] [--device]
 *   ubichill publish <world.yaml>... [--server=<url>] [--out=<dir>] [--public-url=<url>] [--no-install] [--accept-capabilities]
 *   ubichill publish <mods のビルド出力>... [--server=<url>] [--public-url=<url>] [--check-public]   mod の配布物に署名する
 *   ubichill world build <world.yaml> [--id=<instanceId>] [--max-users=<n>] [--out=<path>]   Go に渡す定義 JSON を作る
 *   ubichill dev     [world.yaml] [--port=<n>] [--host[=<addr>]] [--mods-dir=<dir>] [--max-users=<n>]   手元の mod を本番と同じ Go で動かす開発サーバー
 *
 * どのコマンドにも `--debug`（または env UBICHILL_DEBUG=1）を付けられる。ログを詳しくし、失敗にスタックトレースを付ける。
 *
 * `login` はブラウザで承認してこの端末を公開環境にする（鍵は手元だけ）。`publish` はログインしたアカウントで署名して公開する。
 * CI は `ci create` で作った文字列を env UBICHILL_CREDENTIALS に入れて `publish` する。鍵は CLI が作って手元に持つ
 * （鍵ファイルを自分で作って管理する `keygen` / `sign` は廃止。自分のドメインの作者アカウント #181 で必要になれば作り直す）。
 *
 * `lock` は `install` の旧名。非推奨だが後方互換のため残る。
 *
 * このリポジトリ内部からは `node packages/cli/src/index.ts <subcommand> ...` で直接実行できる
 * （Node 22+ の TypeScript 型ストリッピングにより tsx 等は不要。相対importは全て拡張子明示
 * にしているため Node ネイティブの ESM 解決でも問題なく辿れる）。公開パッケージ `@ubichill/cli` では
 * `packages/cli/build.mjs` がこのファイルを esbuild で自己完結バンドルし、`bin` として配布する。
 */
import { runCiCreate, runLogin, runLogout, runPublish, runWhoami } from './account.ts';
import { runBuild } from './build.ts';
import { runDev } from './dev/index.ts';
import { formatHelp } from './help.ts';
import { runInstall } from './install.ts';
import { runLock } from './lock.ts';
import { cliVersion, createCliTerminal, DEBUG_TIP, isLikelyBug, splitGlobalFlags, stderrPaint } from './output.ts';
import { initProject, installPackage, searchPackages } from './packages.ts';
import { runPrefab } from './prefab.ts';
import { runUpdate } from './update.ts';
import { runVerify } from './verify.ts';
import { runVerifyWorld } from './verifyWorld.ts';
import { runWorld } from './world.ts';

const { debug, args } = splitGlobalFlags(process.argv.slice(2));
const term = createCliTerminal(debug);

async function main(): Promise<void> {
    const [subcommand, ...rest] = args;
    switch (subcommand) {
        case 'build':
            await runBuild(rest, term);
            return;
        case 'dev':
            await runDev(rest, term);
            return;
        case 'install':
            if (rest[0]?.startsWith('@') || rest[0]?.startsWith('https://')) await installPackage(rest, term);
            else await runInstall(rest, term);
            return;
        case 'init':
            initProject(rest, term);
            return;
        case 'prefab':
            await runPrefab(rest, term);
            return;
        case 'search':
            await searchPackages(rest, term);
            return;
        case 'update':
            await runUpdate(rest, term);
            return;
        case 'lock': // 非推奨エイリアス
            await runLock(rest, term);
            return;
        case 'verify':
            // <world.yaml> を渡したらワールドの署名、無ければ mod のビルド
            if (rest.some((a) => !a.startsWith('--') && /\.ya?ml$/i.test(a))) await runVerifyWorld(rest, term);
            else await runVerify(rest, term);
            return;
        case 'keygen':
        case 'sign':
            term.failure(new Error(`ubichill ${subcommand} は廃止しました`), {
                hint: '署名は ubichill login（CI は ubichill ci create）のあと ubichill publish で行います。署名の確認は ubichill verify <world.yaml> です',
            });
            process.exit(1);
            return;
        case 'login':
            await runLogin(rest, term);
            return;
        case 'logout':
            await runLogout(rest, term);
            return;
        case 'whoami':
            await runWhoami(rest, term);
            return;
        case 'publish':
            await runPublish(rest, term);
            return;
        case 'world':
            await runWorld(rest, term);
            return;
        case 'ci':
            if (rest[0] === 'create') {
                await runCiCreate(rest.slice(1), term);
                return;
            }
            term.failure(new Error('使い方: ubichill ci create --name=<表示名>'));
            process.exit(1);
            return;
        case 'help':
        case '--help':
        case '-h':
            term.print(formatHelp(cliVersion(), term.paint));
            return;
        default:
            // 引数なし・知らないコマンドは案内を出して失敗で終わる（スクリプトの打ち間違いを成功にしない）
            if (subcommand !== undefined) term.error(`知らないコマンドです: ${subcommand}`);
            process.stderr.write(`${formatHelp(cliVersion(), stderrPaint())}\n`);
            process.exit(1);
    }
}

main().catch((err: unknown) => {
    term.failure(err, isLikelyBug(err) ? { debugTip: DEBUG_TIP } : {});
    process.exit(1);
});
