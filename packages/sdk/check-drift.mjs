/**
 * shared/ecs/loader の変更が sdk のビルド結果（= npm 公開物 `ubichill`）を変えたのに
 * version が上がっていない（changeset を付け忘れた）ケースを fail-closed で検出する。
 *
 * `@ubichill/sdk` は shared/ecs/loader のコードをビルド時にインライン展開して公開する
 * （build.mjs 参照）。これらは private パッケージなので「changeset を付け忘れやすい」
 * （sdk 自身を触っていないので気づきにくい）。この検査は「直近 publish 時点のコミット
 * （publish.mjs が作る `ubichill@<version>` タグ）」と「現在の HEAD」でそれぞれ
 * dist-npm をビルドし、バイト内容を比較する。version が変わっていないのにビルド結果が
 * 変わっていれば、changeset を付け忘れている可能性が高いのでエラーにする。
 *
 * 前提: git worktree が使えること、リポジトリに十分な履歴/タグが fetch されていること
 * （CI では `fetch-depth: 0` + `fetch-tags: true` が必要）。直近の `ubichill@*` タグが
 * 無い場合（初回publish前）は検査をスキップする。
 *
 * 使い方: node check-drift.mjs（cwd は packages/sdk/ 前提、pnpm build:sdk と同じ）
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(sdkDir, '..', '..');

function sh(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf-8', ...opts });
}

function latestPublishTag() {
    const raw = sh('git', ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags/ubichill@*']);
    const tags = raw.trim().split('\n').filter(Boolean);
    return tags[0] ?? null;
}

/** dist-npm の *.js / *.d.ts 全体を連結したsha256（package.json/README/LICENSEは対象外）。 */
function hashDistNpm(dir) {
    const files = readdirSync(dir)
        .filter((f) => /\.(js|d\.ts)$/.test(f))
        .sort();
    const hash = createHash('sha256');
    for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(dir, f)));
    }
    return hash.digest('hex');
}

function main() {
    const tag = latestPublishTag();
    if (!tag) {
        console.log('ℹ️  publish済みタグ (ubichill@*) が無いためドリフト検査をスキップ（初回publish前）');
        return;
    }

    const tagVersion = tag.replace(/^ubichill@/, '');
    const { version: currentVersion } = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf-8'));

    if (currentVersion !== tagVersion) {
        console.log(`✅ version は既に更新済み (${tagVersion} → ${currentVersion})。ドリフト検査は不要`);
        return;
    }

    console.log('🔨 現在のHEADでビルド...');
    // @ubichill/shared は dist/ 経由で解決される（package.json の main/exports 参照）ため、
    // sdk のビルド前に必ず再ビルドしないと shared のソース変更が反映されない（実測: これを
    // やらないと shared だけ変えても drift を検出できず、この検査自体が無意味になる）。
    sh('pnpm', ['--filter', '@ubichill/shared', 'build']);
    sh('pnpm', ['build:sdk']);
    const currentHash = hashDistNpm(join(sdkDir, 'dist-npm'));

    console.log(`🔨 ${tag}（直近publish時点）をworktreeでビルド...`);
    const worktreeDir = mkdtempSync(join(tmpdir(), 'ubichill-drift-'));
    try {
        sh('git', ['worktree', 'add', '--detach', worktreeDir, tag]);
        sh('pnpm', ['install', '--frozen-lockfile'], { cwd: worktreeDir });
        sh('pnpm', ['--filter', '@ubichill/shared', 'build'], { cwd: worktreeDir });
        sh('pnpm', ['--filter', '@ubichill/sdk', 'build'], { cwd: worktreeDir });
        const publishedHash = hashDistNpm(join(worktreeDir, 'packages', 'sdk', 'dist-npm'));

        if (currentHash !== publishedHash) {
            throw new Error(
                `@ubichill/sdk のビルド結果が ${tag}（現行公開バージョン ${tagVersion}）と異なりますが、` +
                    'version は変わっていません。shared/ecs/loader 等の変更が sdk のビルド結果に影響した' +
                    '可能性があります。`pnpm changeset` で @ubichill/sdk 向けの changeset を追加してください。',
            );
        }
        console.log(`✅ ビルド結果は ${tag} と一致（変更なし、version変更は不要）`);
    } finally {
        sh('git', ['worktree', 'remove', '--force', worktreeDir]);
        rmSync(worktreeDir, { recursive: true, force: true });
    }
}

main();
