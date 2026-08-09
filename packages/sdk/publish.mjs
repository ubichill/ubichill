/**
 * npm 公開スクリプト（`ubichill`）。
 *
 * `changeset publish` の自動ルーティング（package.json の publishConfig.directory）は
 * 使わない: これを設定すると pnpm が「ワークスペース内で @ubichill/sdk を参照する全パッケージ
 * （sandbox/frontend/react 等）の node_modules/@ubichill/sdk リンク先」を publishConfig の
 * directory（dist-npm、npm publish 専用の変換済み成果物）に固定してしまい、通常の開発時の
 * ソース解決が壊れる（実測: dist-npm が無い状態だと全パッケージの typecheck が
 * `Cannot find module '@ubichill/sdk'` で失敗する）。よってビルド + npm publish を
 * 直接行うこのスクリプトを使い、publishConfig は使わない。
 *
 * changesets/action のカスタム publish スクリプトとして呼ばれる想定: CHANGESETS_OUTPUT
 * 環境変数（NDJSON ファイルパス）に git-tag イベントを書き込むことで、Action が通常の
 * `changeset publish` と同じように git タグ + GitHub Release（packages/sdk/CHANGELOG.md
 * から該当バージョンのエントリを読む）を作成できるようにする。
 *
 * 使い方: node publish.mjs [--dry-run]（cwd は packages/sdk/ 前提、pnpm build:sdk と同じ）
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(sdkDir, '..', '..');
const dryRun = process.argv.includes('--dry-run');

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

async function main() {
    const { name, version } = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf-8'));

    console.log(`🔨 Building ${name}@${version} publish artifact...`);
    execFileSync('pnpm', ['build:sdk'], { cwd: repoRoot, stdio: 'inherit' });

    const distNpmDir = join(sdkDir, 'dist-npm');
    const published = JSON.parse(readFileSync(join(distNpmDir, 'package.json'), 'utf-8'));
    if (published.version !== version) {
        throw new Error(
            `version mismatch: ${name}@${version}（ソース） != ${published.name}@${published.version}（dist-npm）`,
        );
    }

    // changesets/action は「pending changeset が無い」限り毎回このスクリプトを呼ぶため、
    // sdk本体のバージョンを上げないREADME更新等（packages/sdk/**へのpush）でも実行される。
    // すでに公開済みのバージョンへ npm publish すると常にエラーになるため、fail せず
    // skip する（このバージョンのタグ/Releaseは直前の成功時に作成済みのはず）。
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
        console.log(`🏷️  ${event.tag}（${changesetsOutput} へ記録、changesets/action がgitタグ/Releaseを作成する）`);
    }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((err) => {
        console.error('❌ SDK publish failed:', err);
        process.exit(1);
    });
}
