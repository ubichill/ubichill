/**
 * `@ubichill/cli` の npm 公開物を dist-npm/ に作る。
 *
 * `src/index.ts` を esbuild で 1 ファイル（cli.js）にまとめる。`@ubichill/shared`・`@ubichill/loader` は
 * バンドルに取り込むので、公開物はワークスペースに依存しない。
 *
 * 使い方: node build.mjs [--out-dir=dist-npm]（cwd は packages/cli/ 前提）
 */
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTANCE_PLATFORMS, instancePackageName } from './src/instancePlatforms.ts';
import { worldDistFiles } from './worldDist.mjs';

const cliDir = dirname(fileURLToPath(import.meta.url));

const outDirArg = process.argv.slice(2).find((a) => a.startsWith('--out-dir='));
const outDir = outDirArg ? join(cliDir, outDirArg.split('=')[1]) : join(cliDir, 'dist-npm');

/**
 * `esbuild`/`yaml` は external 必須: 両者とも内部で CJS 由来の動的 require（`fs`/`process` の require）を
 * 行うコードパスを持ち、単一 ESM ファイルへバンドルすると `Dynamic require of "..." is not supported` で
 * 実行時に落ちる（実測済み）。公開パッケージの `dependencies` として残す。
 */
export const CLI_RUNTIME_DEPENDENCIES = { esbuild: '^0.28.0', yaml: '^2.5.0' };

/**
 * shebang は entry (`src/index.ts`) 自身の先頭行を esbuild が自動的に出力先頭へ保持するため、
 * banner として付け直すと二重になり Node の shebang 剥がし（先頭行のみ対象）が効かなくなる。banner は指定しない。
 */
export async function buildCliJs() {
    const result = await esbuild.build({
        entryPoints: [join(cliDir, 'src', 'index.ts')],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        write: false,
        minify: false,
        external: Object.keys(CLI_RUNTIME_DEPENDENCIES),
    });
    return result.outputFiles[0].text;
}

/**
 * Go のインスタンスサーバー（`ubichill dev` が起動する）。プラットフォームごとの optionalDependency で、
 * os・cpu の合う 1 つだけが入る。版は @ubichill/instance（changesets の fixed グループで cli と同じ版）に完全一致させる。
 */
export function instanceDependencies() {
    const { version } = JSON.parse(readFileSync(join(cliDir, '..', 'instance', 'package.json'), 'utf-8'));
    return Object.fromEntries(INSTANCE_PLATFORMS.map((platform) => [instancePackageName(platform), version]));
}

export function buildPackageJson() {
    const pkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8'));
    return JSON.stringify(
        {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            // SDK と同じく MIT（mod 開発者の環境に入るものなので、本体の AGPL を引き継がない）
            license: 'MIT',
            repository: { type: 'git', url: 'git+https://github.com/ubichill/ubichill.git' },
            type: 'module',
            bin: { ubichill: './cli.js' },
            engines: { node: '>=22' },
            files: ['cli.js', 'world', 'LICENSE', 'README.md'],
            dependencies: CLI_RUNTIME_DEPENDENCIES,
            optionalDependencies: instanceDependencies(),
        },
        null,
        2,
    );
}

/**
 * `ubichill dev` が配る `world.html`（SNS 無しでワールドを動かす画面）とその assets を同梱する。
 * frontend のビルド出力（turbo が先に作る）から、world.html が使うファイルだけを写す。
 */
export function copyWorldDist(outWorldDir) {
    const distDir = join(cliDir, '..', 'frontend', 'dist');
    if (!existsSync(join(distDir, '.vite', 'manifest.json'))) {
        throw new Error(`${distDir} に frontend のビルドがありません（pnpm --filter @ubichill/frontend build）`);
    }
    const files = worldDistFiles(distDir);
    for (const file of files) {
        const target = join(outWorldDir, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(distDir, file), target);
    }
    console.log(`✅ world/ (${files.length} files)`);
    return files;
}

async function main() {
    console.log('🔨 Building @ubichill/cli (npm publish package)...');
    // 前のビルドの残りを配らない（files は dist-npm の中身をそのまま載せる）
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const cliJs = await buildCliJs();
    writeFileSync(join(outDir, 'cli.js'), cliJs, { encoding: 'utf-8', mode: 0o755 });
    console.log(`✅ cli.js (${cliJs.length} bytes)`);

    copyWorldDist(join(outDir, 'world'));

    writeFileSync(join(outDir, 'package.json'), buildPackageJson(), 'utf-8');
    copyFileSync(join(cliDir, 'LICENSE'), join(outDir, 'LICENSE'));
    copyFileSync(join(cliDir, 'README.md'), join(outDir, 'README.md'));
    console.log(`📦 ${outDir}`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((err) => {
        console.error('❌ CLI build failed:', err);
        process.exit(1);
    });
}
