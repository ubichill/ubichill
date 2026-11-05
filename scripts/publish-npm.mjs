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
 *   各パッケージについて `pnpm --filter <name> build` で dist-npm を作り、`npm publish dist-npm` する。
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

/** 1 パッケージを dist-npm からビルドして公開する。 */
export function publishPackage(packageDir, { dryRun }) {
    const dir = resolve(repoRoot, packageDir);
    const { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));

    console.log(`🔨 Building ${name}@${version} publish artifact...`);
    execFileSync('pnpm', ['--filter', name, 'build'], { cwd: repoRoot, stdio: 'inherit' });

    const distNpmDir = join(dir, 'dist-npm');
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
        console.log(`⏭️  ${published.name}@${published.version} は既に公開済み。npm publish をスキップする。`);
        return;
    }

    if (dryRun) {
        console.log(`🧪 --dry-run: npm publish はスキップ（${published.name}@${published.version}）`);
    } else {
        console.log(`📦 npm publish ${published.name}@${published.version} (dist-npm, OIDC trusted publishing)`);
        execFileSync('npm', ['publish', distNpmDir, '--access', 'public'], { cwd: repoRoot, stdio: 'inherit' });
    }

    const changesetsOutput = process.env.CHANGESETS_OUTPUT;
    if (changesetsOutput) {
        const event = { type: 'git-tag', tag: `${published.name}@${published.version}`, packageName: name };
        appendFileSync(changesetsOutput, `${JSON.stringify(event)}\n`, 'utf-8');
        console.log(`🏷️  ${event.tag}（${changesetsOutput} へ記録、changesets/action が git タグ/Release を作成する）`);
    }
}

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const packageDirs = args.filter((a) => !a.startsWith('--'));
    if (packageDirs.length === 0) throw new Error('usage: node scripts/publish-npm.mjs <packageDir>... [--dry-run]');
    for (const packageDir of packageDirs) publishPackage(packageDir, { dryRun });
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    try {
        main();
    } catch (err) {
        console.error('❌ publish failed:', err);
        process.exit(1);
    }
}
