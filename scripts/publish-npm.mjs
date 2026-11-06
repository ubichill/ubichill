/**
 * npm 公開スクリプト（`ubichill`・`@ubichill/cli` など、dist-npm/ を持つパッケージ）。
 *
 * `changeset publish` の自動ルーティング（package.json の publishConfig.directory）は
 * 使わない: これを設定すると pnpm が「ワークスペース内でそのパッケージを参照する全パッケージの
 * node_modules のリンク先」を publishConfig の directory（dist-npm、npm publish 専用の変換済み成果物）に
 * 固定してしまい、通常の開発時のソース解決が壊れる（実測: dist-npm が無い状態だと全パッケージの typecheck が
 * `Cannot find module '@ubichill/sdk'` で失敗する）。よってビルド + npm publish を直接行うこのスクリプトを使う。
 *
 * changesets/action のカスタム publish スクリプトとして呼ばれる想定: CHANGESETS_OUTPUT 環境変数
 * （NDJSON ファイルパス）に git-tag イベントを書き込むことで、Action が通常の `changeset publish` と
 * 同じように git タグ + GitHub Release（各パッケージの CHANGELOG.md から該当バージョンのエントリを読む）を作成できる。
 *
 * 使い方: node scripts/publish-npm.mjs <packages/sdk> [<packages/cli> ...] [--dry-run]
 *   各パッケージについて `pnpm turbo build --filter=<name>` で dist-npm を作り、`npm publish dist-npm` する。
 *   turbo を通すのは、turbo.json に書いたビルドの依存（@ubichill/cli は world.html を同梱するので frontend のビルド）も走らせるため。
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerminal, DEBUG_ENV, debugFromEnv, formatDuration, HintedError, processIO } from '@ubichill/terminal';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });

/** 指定バージョンが既にレジストリに公開済みか（`npm view` は該当バージョンが無いと非ゼロ終了する）。 */
export function isAlreadyPublished(name, version) {
    try {
        const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return out === version;
    } catch {
        return false;
    }
}

/**
 * 公開物のディレクトリ。dist-npm に package.json があればそれ 1 つ、無ければ dist-npm/<name>/ の各ディレクトリ
 * （@ubichill/instance はプラットフォームごとに別のパッケージを出す）。
 */
export function publishDirs(distNpmDir) {
    if (existsSync(join(distNpmDir, 'package.json'))) return [distNpmDir];
    return readdirSync(distNpmDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(distNpmDir, entry.name, 'package.json')))
        .map((entry) => join(distNpmDir, entry.name))
        .sort();
}

/** 公開物を作るコマンド。turbo.json の依存（`@ubichill/cli#build` → `@ubichill/frontend#build` など）を通す。 */
export const buildCommand = (name) => ['turbo', 'build', `--filter=${name}`];

/** 1 つのワークスペースのパッケージをビルドし、その公開物（1 つまたは複数）を公開する。 */
export function publishPackage(packageDir, { dryRun }) {
    const dir = resolve(repoRoot, packageDir);
    const { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));

    term.info(`Building ${name}@${version} publish artifact...`);
    const started = performance.now();
    execFileSync('pnpm', buildCommand(name), { cwd: repoRoot, stdio: 'inherit' });
    term.success(`Built ${name}@${version} publish artifact`, formatDuration(performance.now() - started));

    for (const distNpmDir of publishDirs(join(dir, 'dist-npm'))) publishDir(name, version, distNpmDir, { dryRun });
}

function publishDir(name, version, distNpmDir, { dryRun }) {
    const published = JSON.parse(readFileSync(join(distNpmDir, 'package.json'), 'utf-8'));
    if (published.version !== version) {
        throw new Error(
            `version mismatch: ${name}@${version}（ソース） != ${published.name}@${published.version}（dist-npm）`,
        );
    }

    // changesets/action は「pending changeset が無い」限り毎回このスクリプトを呼ぶため、
    // バージョンを上げない README 更新等でも実行される。公開済みのバージョンへの publish は常にエラーになるので skip する
    // （このバージョンのタグ/Release は直前の成功時に作成済み）。
    if (!dryRun && isAlreadyPublished(published.name, published.version)) {
        term.info(`${published.name}@${published.version} は既に公開済み。npm publish をスキップする`);
        return;
    }

    if (dryRun) {
        term.info(`--dry-run: npm publish はスキップ（${published.name}@${published.version}）`);
    } else {
        term.info(`npm publish ${published.name}@${published.version}`, 'dist-npm, OIDC trusted publishing');
        execFileSync('npm', ['publish', distNpmDir, '--access', 'public'], { cwd: repoRoot, stdio: 'inherit' });
        term.success(`Published ${published.name}@${published.version}`);
    }

    const changesetsOutput = process.env.CHANGESETS_OUTPUT;
    if (changesetsOutput) {
        const event = { type: 'git-tag', tag: `${published.name}@${published.version}`, packageName: name };
        appendFileSync(changesetsOutput, `${JSON.stringify(event)}\n`, 'utf-8');
        term.success(`${event.tag} を ${changesetsOutput} へ記録`, 'changesets/action が git タグ/Release を作成する');
    }
}

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const packageDirs = args.filter((a) => !a.startsWith('--'));
    if (packageDirs.length === 0) {
        throw new HintedError(
            'No package directory given',
            'usage: node scripts/publish-npm.mjs <packageDir>... [--dry-run]',
        );
    }
    for (const packageDir of packageDirs) publishPackage(packageDir, { dryRun });
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    try {
        main();
    } catch (err) {
        term.failure(
            err,
            err instanceof HintedError ? {} : { debugTip: `${DEBUG_ENV}=1 を付けるとスタックトレースを表示します` },
        );
        process.exit(1);
    }
}
