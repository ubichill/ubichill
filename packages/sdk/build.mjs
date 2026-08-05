/**
 * build.mjs
 *
 * `@ubichill/sdk`（ワークスペース内パッケージ、名前は不変）を npm 公開用の
 * 自己完結パッケージ `ubichill`（unscoped）としてビルドする。
 *
 * 他パッケージ（shared/db 等）と同様、パッケージ自身が自分のビルド方法を持つ
 * （`pnpm --filter @ubichill/sdk build`、または `pnpm build:sdk`）。旧 scripts/build-sdk.mjs
 * から移設（CLI等の公開物を将来 sdk パッケージ内に置けるよう、repo-root の scripts/ には
 * 汎用ではない単発ロジックを置かない方針に揃えた）。
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
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** `ubichill` の bin エントリ（mod開発者向け CLI）。型surfaceではないので .d.ts は生成しない。 */
const CLI_ENTRY = { name: 'cli', srcPath: join(sdkDir, 'cli', 'index.ts') };

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
    });
    return result.outputFiles[0].text;
}

/**
 * CLI 用バンドル（Node専用、self-contained）。
 * shebang は entry (`cli/index.ts`) 自身の先頭行を esbuild が自動的に出力先頭へ保持するため、
 * ここで banner として付け直すと二重になり Node の shebang 剥がし（先頭行のみ対象）が
 * 効かなくなって SyntaxError になる（実測済み）。banner は指定しない。
 *
 * `esbuild`/`yaml` は external 必須: 両者とも内部で CJS 由来の動的 require（`fs`/`process`
 * の require）を行うコードパスを持ち、単一 ESM ファイルへバンドルすると `Dynamic require of
 * "..." is not supported` で実行時に落ちる（実測済み）。よって CLI_RUNTIME_DEPENDENCIES として
 * 公開パッケージの `dependencies` に real dependency として残す。
 */
const CLI_RUNTIME_DEPENDENCIES = { esbuild: '^0.28.0', yaml: '^2.5.0' };

export async function buildCliJs() {
    const result = await esbuild.build({
        entryPoints: [CLI_ENTRY.srcPath],
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
            bin: { ubichill: './cli.js' },
            // CLI（cli.js）は esbuild で target: 'node22' にビルドしている。import surface は
            // それより緩い es2020 だが、同一パッケージなので engines は CLI 側の要件に揃える。
            engines: { node: '>=22' },
            exports: {
                '.': { types: './index.d.ts', import: './index.js' },
                './jsx-runtime': { types: './jsx-runtime.d.ts', import: './jsx-runtime.js' },
                './gripable': { types: './gripable.d.ts', import: './gripable.js' },
            },
            files: ['*.js', '*.d.ts', 'LICENSE', 'README.md'],
            // import surface（index/jsx-runtime/gripable）の実行時依存はビルド時に esbuild で
            // 完全バンドル済み（@ubichill/ecs 全体 + @ubichill/shared の一部シンボル）。
            // bin（cli.js）だけが esbuild を external にしているため、real dependency として残す
            // （CLI_RUNTIME_DEPENDENCIES 参照）。
            dependencies: CLI_RUNTIME_DEPENDENCIES,
        },
        null,
        2,
    );
}

async function main() {
    console.log('🔨 Building ubichill (npm publish package) from @ubichill/sdk...');
    mkdirSync(outDir, { recursive: true });

    for (const entry of ENTRIES) {
        const js = await buildJs(entry);
        writeFileSync(join(outDir, `${entry.name}.js`), js, 'utf-8');
        console.log(`✅ ${entry.name}.js (${js.length} bytes)`);

        const dts = buildDts(entry);
        writeFileSync(join(outDir, `${entry.name}.d.ts`), dts, 'utf-8');
        console.log(`✅ ${entry.name}.d.ts (${dts.length} bytes, 外部@ubichill参照なし)`);
    }

    const cliJs = await buildCliJs();
    writeFileSync(join(outDir, 'cli.js'), cliJs, { encoding: 'utf-8', mode: 0o755 });
    console.log(`✅ cli.js (${cliJs.length} bytes)`);

    writeFileSync(join(outDir, 'package.json'), buildPackageJson(), 'utf-8');
    console.log(`📦 ${outDir}/package.json (name: "ubichill")`);

    copyFileSync(join(sdkDir, 'LICENSE'), join(outDir, 'LICENSE'));
    console.log(`📄 ${outDir}/LICENSE (MIT)`);

    copyFileSync(join(sdkDir, 'README.md'), join(outDir, 'README.md'));
    console.log(`📄 ${outDir}/README.md`);

    console.log('🎉 SDK publish package built.');
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    main().catch((err) => {
        console.error('❌ SDK build failed:', err);
        process.exit(1);
    });
}
