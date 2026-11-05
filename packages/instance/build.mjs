/**
 * Go のインスタンスサーバーをプラットフォームごとにクロスビルドし、npm 公開物を dist-npm/<os>-<cpu>/ に作る。
 *
 * 1 つのプラットフォーム = 1 つのパッケージ（`@ubichill/instance-<os>-<cpu>`）。package.json の `os`・`cpu` で
 * 合う環境にだけ入る（`@ubichill/cli` の optionalDependencies）。版は @ubichill/cli と同じ（changesets の fixed グループ）。
 * CGO を使わないので、どの OS からでも全部をビルドできる。`-trimpath` で再現可能なビルドにする（drift 検査が同じ版の
 * バイナリを比べられる）。
 *
 * 使い方: node build.mjs [--platform=<os>-<cpu>]（cwd は packages/instance/ 前提。省略時は全部）
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goTarget, INSTANCE_PLATFORMS, instanceBinaryName, instancePackageName } from '../cli/src/instancePlatforms.ts';

const here = dirname(fileURLToPath(import.meta.url));
const goDir = join(here, '..', '..', 'services', 'instance');
const outDir = join(here, 'dist-npm');
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf-8'));

export function platformPackageJson(platform, packageVersion) {
    return JSON.stringify(
        {
            name: instancePackageName(platform),
            version: packageVersion,
            description: `ubichill instance server (Go) for ${platform.os}-${platform.cpu}. Installed by @ubichill/cli.`,
            license: 'AGPL-3.0-only',
            repository: { type: 'git', url: 'git+https://github.com/ubichill/ubichill.git' },
            os: [platform.os],
            cpu: [platform.cpu],
            files: [instanceBinaryName(platform.os)],
        },
        null,
        2,
    );
}

export function buildPlatform(platform) {
    const dir = join(outDir, `${platform.os}-${platform.cpu}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const binary = join(dir, instanceBinaryName(platform.os));
    execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', binary, './cmd/instance'], {
        cwd: goDir,
        stdio: 'inherit',
        env: { ...process.env, ...goTarget(platform), CGO_ENABLED: '0' },
    });
    writeFileSync(join(dir, 'package.json'), platformPackageJson(platform, version), 'utf-8');
    copyFileSync(join(here, '..', '..', 'LICENSE'), join(dir, 'LICENSE'));
    return dir;
}

function main() {
    const only = process.argv.slice(2).find((a) => a.startsWith('--platform='))?.slice('--platform='.length);
    const targets = INSTANCE_PLATFORMS.filter((p) => !only || `${p.os}-${p.cpu}` === only);
    if (targets.length === 0) throw new Error(`--platform=${only} は配っていません`);
    for (const platform of targets) {
        console.log(`🔨 ${instancePackageName(platform)}@${version}`);
        buildPlatform(platform);
    }
    console.log(`📦 ${outDir} (${targets.length} platforms)`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
