/**
 * shared/ecs/loader の変更が npm 公開物（`ubichill`・`@ubichill/cli`）のビルド結果を変えたのに
 * version が上がっていない（changeset を付け忘れた）ケースを fail-closed で検出する。
 *
 * これらのパッケージは shared/ecs/loader のコードをビルド時にインライン展開して公開する。インライン元は
 * private パッケージなので「changeset を付け忘れやすい」（公開パッケージ自身を触っていないので気づきにくい）。
 * この検査は「直近 publish 時点のコミット（publish-npm.mjs が作る `<公開名>@<version>` タグ）」と
 * 「現在の HEAD」でそれぞれ dist-npm をビルドし、バイト内容を比較する。version が変わっていないのに
 * ビルド結果が変わっていれば、changeset を付け忘れている可能性が高いのでエラーにする。
 *
 * 前提: git worktree が使えること、リポジトリに十分な履歴/タグが fetch されていること
 * （CI では `fetch-depth: 0` + `fetch-tags: true` が必要）。直近のタグが無い場合（初回 publish 前）は検査をスキップする。
 *
 * 使い方: node scripts/check-npm-drift.mjs <packages/sdk> [<packages/cli> ...]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function sh(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf-8', ...opts });
}

function latestPublishTag(publishedName) {
    const raw = sh('git', [
        'for-each-ref',
        '--sort=-creatordate',
        '--format=%(refname:short)',
        `refs/tags/${publishedName}@*`,
    ]);
    const tags = raw.trim().split('\n').filter(Boolean);
    return tags[0] ?? null;
}

/** dist-npm の中身（package.json / README / LICENSE 以外。Go のバイナリも含む）を連結した sha256。 */
function hashDistNpm(dir) {
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && !['package.json', 'README.md', 'LICENSE'].includes(entry.name))
        .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
        .sort();
    const hash = createHash('sha256');
    for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(dir, f)));
    }
    return hash.digest('hex');
}

/**
 * タグの名前。公開名は dist-npm の package.json にある（ワークスペース名と違うことがある: @ubichill/sdk → ubichill）。
 * 複数の公開物を出すパッケージ（@ubichill/instance）は最初の公開物のタグで代表する（版は同じ）。
 */
function publishedNameOf(packageDir) {
    sh('pnpm', ['turbo', 'build', `--filter=${workspaceNameOf(packageDir)}`]);
    const distNpm = join(packageDir, 'dist-npm');
    const own = join(distNpm, 'package.json');
    const first = readdirSync(distNpm).sort().find((name) => existsSync(join(distNpm, name, 'package.json')));
    return JSON.parse(readFileSync(existsSync(own) ? own : join(distNpm, first, 'package.json'), 'utf-8')).name;
}

function workspaceNameOf(packageDir) {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')).name;
}

function checkPackage(relativeDir) {
    const packageDir = resolve(repoRoot, relativeDir);
    const workspaceName = workspaceNameOf(packageDir);
    // @ubichill/shared は dist/ 経由で解決される（package.json の main/exports 参照）ため、
    // ビルド前に必ず再ビルドしないと shared のソース変更が反映されない（これをやらないと shared だけ変えても
    // drift を検出できず、この検査自体が無意味になる）。
    console.log(`🔨 [${workspaceName}] 現在の HEAD でビルド...`);
    sh('pnpm', ['turbo', 'build', '--filter=@ubichill/shared']);
    const publishedName = publishedNameOf(packageDir);
    const tag = latestPublishTag(publishedName);
    if (!tag) {
        console.log(`ℹ️  [${workspaceName}] publish 済みタグ (${publishedName}@*) が無いためドリフト検査をスキップ（初回 publish 前）`);
        return;
    }

    const tagVersion = tag.replace(`${publishedName}@`, '');
    const { version: currentVersion } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'));
    if (currentVersion !== tagVersion) {
        console.log(`✅ [${workspaceName}] version は既に更新済み (${tagVersion} → ${currentVersion})。ドリフト検査は不要`);
        return;
    }
    const currentHash = hashDistNpm(join(packageDir, 'dist-npm'));

    console.log(`🔨 [${workspaceName}] ${tag}（直近 publish 時点）を worktree でビルド...`);
    const worktreeDir = mkdtempSync(join(tmpdir(), 'ubichill-drift-'));
    try {
        sh('git', ['worktree', 'add', '--detach', worktreeDir, tag]);
        sh('pnpm', ['install', '--frozen-lockfile'], { cwd: worktreeDir });
        sh('pnpm', ['turbo', 'build', '--filter=@ubichill/shared'], { cwd: worktreeDir });
        sh('pnpm', ['turbo', 'build', `--filter=${workspaceName}`], { cwd: worktreeDir });
        const publishedHash = hashDistNpm(join(worktreeDir, relativeDir, 'dist-npm'));
        if (currentHash !== publishedHash) {
            throw new Error(
                `${workspaceName} のビルド結果が ${tag}（現行公開バージョン ${tagVersion}）と異なりますが、` +
                    'version は変わっていません。shared/ecs/loader 等の変更がビルド結果に影響した可能性があります。' +
                    `\`pnpm changeset\` で ${workspaceName} 向けの changeset を追加してください。`,
            );
        }
        console.log(`✅ [${workspaceName}] ビルド結果は ${tag} と一致（変更なし、version 変更は不要）`);
    } finally {
        sh('git', ['worktree', 'remove', '--force', worktreeDir]);
        rmSync(worktreeDir, { recursive: true, force: true });
    }
}

const packageDirs = process.argv.slice(2);
if (packageDirs.length === 0) {
    console.error('usage: node scripts/check-npm-drift.mjs <packageDir>...');
    process.exit(1);
}
for (const dir of packageDirs) checkPackage(dir);
