/**
 * build.mjs
 *
 * `@ubichill/sdk`（ワークスペース内パッケージ、名前は不変）を npm 公開用の
 * 自己完結パッケージ `ubichill`（unscoped）としてビルドする。
 *
 * 他パッケージ（shared/db 等）と同様、パッケージ自身が自分のビルド方法を持つ
 * （`pnpm --filter @ubichill/sdk build`、または `pnpm build:sdk`）。CLI は packages/cli（`@ubichill/cli`）。
 *
 * 設計方針:
 * - ワークスペース内の名前・全参照（mods 配下各 tsconfig の paths, sandbox.worker.ts の import,
 *   build-workers.mjs の jsxImportSource）は変更しない。publish 専用の別ディレクトリ
 *   （dist-npm/）に、公開用の package.json を新規生成するだけでリポジトリ全体への影響を
 *   ゼロに抑える。
 * - SDK の実行時依存は `@ubichill/ecs` 全体と `@ubichill/shared` の一部シンボル
 *   （CommandType/UbiError/UbiErrorCode、zod 不使用）のみと確認済み。esbuild で
 *   `external: []`（何も外部化しない）で完全バンドルし、公開パッケージの
 *   `dependencies` をゼロにする。
 * - 型定義: SDK の公開型は `@ubichill/ecs` を丸ごと re-export + `@ubichill/shared` の
 *   複数サブパスから re-export しており、手でローカル型に書き直すのは非現実的。加えて実験で
 *   確認済み: 未インストールの外部モジュールを指す型参照は、使われていない型でも
 *   TypeScript が解決を試みて即エラーになる（TS2307）。よって dts-bundle-generator で
 *   `@ubichill/ecs`/`@ubichill/shared` の使用型を実際にインライン展開し、外部モジュール
 *   指定子の残らない単一 .d.ts を生成する。生成後に `from '@ubichill` が残っていないかを
 *   grep で検証し、残っていればビルドを失敗させる（fail-closed）。
 *
 * 使い方: node build.mjs [--out-dir=dist-npm]（cwd は packages/sdk/ 前提）
 */
import { generateDtsBundle } from 'dts-bundle-generator';
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createTerminal,
    DEBUG_ENV,
    debugFromEnv,
    formatBytes,
    formatDuration,
    HintedError,
    processIO,
} from '@ubichill/terminal';

const sdkDir = dirname(fileURLToPath(import.meta.url));
const sdkTsconfig = join(sdkDir, 'tsconfig.json');

const outDirArg = process.argv.slice(2).find((a) => a.startsWith('--out-dir='));
const outDir = outDirArg ? join(sdkDir, outDirArg.split('=')[1]) : join(sdkDir, 'dist-npm');

/** 公開する 3 エントリ（SDK の package.json exports と対応）。 */
export const ENTRIES = [
    { name: 'index', srcPath: join(sdkDir, 'src', 'index.ts') },
    { name: 'jsx-runtime', srcPath: join(sdkDir, 'src', 'jsx', 'jsx-runtime.ts') },
    { name: 'gripable', srcPath: join(sdkDir, 'src', 'jsx', 'Gripable.tsx') },
];

/** ecs 全体 + shared の使用シンボルをインライン展開し、外部参照の無い単一 .d.ts を作る。 */
export function buildDts(entry) {
    const [dts] = generateDtsBundle(
        [
            {
                filePath: entry.srcPath,
                libraries: { inlinedLibraries: ['@ubichill/ecs', '@ubichill/shared'] },
                output: { noBanner: true },
            },
        ],
        { preferredConfigPath: sdkTsconfig },
    );

    // fail-closed: 実際の import/export 文（コード行）に外部モジュール指定子（@ubichill/*）が
    // 残っていたら公開できないパッケージが生成されたことになる。手動確認済みの実験
    // （TS2307）の再発防止。JSDoc コメント中の `{@link import('@ubichill/sdk')...}` 等の
    // 文章的参照は型解決に関与しないため対象外（行頭が `import`/`export` のコード行のみ検査）。
    const leaked = dts.split('\n').filter((line) => /^\s*(import|export)\b.*['"]@ubichill\//.test(line));
    if (leaked.length > 0) {
        throw new Error(
            `[build-sdk] ${entry.name}.d.ts に未解決の @ubichill/* 参照が残っている（inline失敗）:\n` +
                leaked.map((l) => `  ${l.trim()}`).join('\n'),
        );
    }
    return dts;
}

/** esbuild で完全バンドル（external なし）。ecs/shared のランタイム依存を同梱する。 */
export async function buildJs(entry) {
    const result = await esbuild.build({
        entryPoints: [entry.srcPath],
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        target: 'es2020',
        jsx: 'automatic',
        jsxImportSource: '@ubichill/sdk',
        write: false,
        minify: false,
        external: [],
        // shared の dist は CommonJS。そのまま同梱すると `__toESM(require_x())` という top-level 呼び出しになり、
        // mod 側のバンドラが使っていない SDK のコードを tree-shake できない（#222）。ESM のソースを直接読む。
        alias: { '@ubichill/shared': join(sdkDir, '..', 'shared', 'src') },
    });
    return result.outputFiles[0].text;
}

export function buildPackageJson() {
    const sdkPackageJson = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf-8'));

    return JSON.stringify(
        {
            name: 'ubichill',
            version: sdkPackageJson.version,
            description: sdkPackageJson.description,
            // モノレポ本体（Host/backend/frontend）は AGPL-3.0-only だが、SDK は外部mod開発者が
            // 自分のコード（ライセンス不問）に組み込むためのライブラリなので、コピーレフトの
            // 継承を避け MIT にする（packages/sdk/LICENSE、リポジトリ本体とは別ファイル）。
            license: 'MIT',
            repository: { type: 'git', url: 'git+https://github.com/ubichill/ubichill.git' },
            type: 'module',
            sideEffects: false,
            main: './index.js',
            types: './index.d.ts',
            exports: {
                '.': { types: './index.d.ts', import: './index.js' },
                './jsx-runtime': { types: './jsx-runtime.d.ts', import: './jsx-runtime.js' },
                './gripable': { types: './gripable.d.ts', import: './gripable.js' },
            },
            files: ['*.js', '*.d.ts', 'LICENSE', 'README.md'],
            // 実行時依存はビルド時に esbuild で完全バンドル済み（@ubichill/ecs 全体 + @ubichill/shared の一部シンボル）。
            // CLI は別パッケージ（@ubichill/cli）なので、ここには依存が 1 つも無い。
            dependencies: {},
        },
        null,
        2,
    );
}

/** fn を実行し、結果とかかった時間を返す。 */
async function measure(fn) {
    const started = performance.now();
    const value = await fn();
    return { value, took: formatDuration(performance.now() - started) };
}

async function main(term) {
    const started = performance.now();
    term.info('Building ubichill (npm publish package) from @ubichill/sdk...');
    // 前のビルドの残り（以前は cli.js もここにあった）を配らない（files の *.js は dist-npm の中身をそのまま載せる）
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    for (const entry of ENTRIES) {
        const js = await measure(() => buildJs(entry));
        writeFileSync(join(outDir, `${entry.name}.js`), js.value, 'utf-8');
        term.success(`${entry.name}.js`, `${formatBytes(Buffer.byteLength(js.value))}  ${js.took}`);

        const dts = await measure(() => buildDts(entry));
        writeFileSync(join(outDir, `${entry.name}.d.ts`), dts.value, 'utf-8');
        term.success(
            `${entry.name}.d.ts`,
            `${formatBytes(Buffer.byteLength(dts.value))}  ${dts.took}  外部@ubichill参照なし`,
        );
    }

    writeFileSync(join(outDir, 'package.json'), buildPackageJson(), 'utf-8');
    term.success('package.json', 'name: ubichill');

    copyFileSync(join(sdkDir, 'LICENSE'), join(outDir, 'LICENSE'));
    term.success('LICENSE', 'MIT');

    copyFileSync(join(sdkDir, 'README.md'), join(outDir, 'README.md'));
    term.success('README.md');

    term.success(
        `SDK publish package built in ${formatDuration(performance.now() - started)}`,
        relative(process.cwd(), outDir) || '.',
    );
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
    main(term).catch((err) => {
        term.failure(
            err,
            err instanceof HintedError ? {} : { debugTip: `${DEBUG_ENV}=1 を付けるとスタックトレースを表示します` },
        );
        process.exit(1);
    });
}
