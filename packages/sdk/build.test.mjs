import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJs, buildPackageJson, ENTRIES } from './build.mjs';

// このファイルは高速なチェックのみ（buildJs は esbuild で ~数十ms）。
// buildDts（TS Compiler API フルコンパイル、実測20秒級・不可避）を要するテストは
// build.dts.verify.mjs に分離した（vitest の既定 include には引っ掛からない
// ファイル名にして、通常の `pnpm test`/開発ループを重くしない。CI/検証時に明示的に走らせる）。

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkLicensePath = join(__dirname, 'LICENSE');
const INDEX_ENTRY = ENTRIES.find((e) => e.name === 'index');

describe('buildJs（SDK 完全バンドル）', () => {
    let code;
    beforeAll(async () => {
        code = await buildJs(INDEX_ENTRY);
    });

    it('zod / Host専用スキーマが混入しない（ecs全体 + shared一部シンボルのみ実行時依存）', () => {
        expect(code).not.toMatch(/ZodObject|ZodString|ZodError/);
        expect(code).not.toMatch(/WorldDefinitionSchema|CAPABILITY_CATALOG|PermissionPolicy/);
    });

    it('UbiSDK が実際にバンドルされている', () => {
        expect(code).toMatch(/UbiSDK/);
    });

    it('CommonJS のラッパーを含まない（shared の dist ではなくソースを読んでいる）', () => {
        expect(code).not.toMatch(/__commonJS|__toESM/);
    });
});

// npm 版を使う mod のバンドルに、使っていない SDK の実装が入らないこと（#222）。
// mod は Host が注入するグローバル Ubi を使うので、UbiSDK 本体は普通の mod には要らない。
const consumerDir = mkdtempSync(join(tmpdir(), 'ubichill-sdk-treeshake-'));
const packageDir = join(consumerDir, 'node_modules', 'ubichill');
mkdirSync(packageDir, { recursive: true });
writeFileSync(join(packageDir, 'package.json'), buildPackageJson());
await Promise.all(
    ENTRIES.map(async (entry) => writeFileSync(join(packageDir, `${entry.name}.js`), await buildJs(entry))),
);
const published = await import(pathToFileURL(join(packageDir, 'index.js')).href);
afterAll(() => rmSync(consumerDir, { recursive: true, force: true }));

/** UbiSDK 本体にしか無い文字列。private フィールド名と内部のコマンド名は minify しても残る。 */
const UBISDK_MARKERS = ['_pendingRequests', '_commandCounter', 'SCENE_GET_ENTITY'];

/** packages/cli/src/build.ts の bundleWorker と同じ設定で、1 ファイルの mod をバンドルする。 */
async function bundleMod(source, tsconfigRaw) {
    const result = await esbuild.build({
        stdin: { contents: source, loader: 'tsx', resolveDir: consumerDir, sourcefile: 'mod.worker.tsx' },
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: 'ubichill',
        minify: true,
        write: false,
        logLevel: 'silent',
        tsconfigRaw,
    });
    return result.outputFiles[0].text;
}

function expectNoUbiSdk(code) {
    for (const marker of UBISDK_MARKERS) {
        expect(code, `UbiSDK 本体（${marker}）が mod のバンドルに入っている`).not.toContain(marker);
    }
}

describe('npm 版 SDK の tree-shake（mod のバンドルに入るもの）', () => {
    it('目印は UbiSDK を使えば実際に入る（目印が的外れでテストが素通りしていないことの確認）', async () => {
        const code = await bundleMod("import { UbiSDK } from 'ubichill'; console.log(UbiSDK);");
        for (const marker of UBISDK_MARKERS) expect(code).toContain(marker);
    });

    it('CORE_COMPONENT_TYPES だけ使う mod には、その定数を自分で書いたときと同じ大きさしか入らない', async () => {
        const code = await bundleMod("import { CORE_COMPONENT_TYPES } from 'ubichill'; console.log(CORE_COMPONENT_TYPES);");
        const handWritten = await bundleMod(
            `var CORE_COMPONENT_TYPES = ${JSON.stringify(published.CORE_COMPONENT_TYPES)}; console.log(CORE_COMPONENT_TYPES);`,
        );
        expectNoUbiSdk(code);
        expect(code.length).toBe(handWritten.length);
    });

    it.each(
        Object.keys(published).filter((name) => name !== 'UbiSDK'),
    )('%s だけ使う mod に UbiSDK 本体が入らない', async (name) => {
        expectNoUbiSdk(await bundleMod(`import { ${name} } from 'ubichill'; console.log(${name});`));
    });

    it('名前空間 import でもプロパティを読むだけなら UbiSDK 本体が入らない', async () => {
        expectNoUbiSdk(await bundleMod("import * as sdk from 'ubichill'; console.log(sdk.PROTOCOL_VERSION);"));
    });

    it('Ubi の型だけ使う mod には SDK の実装が何も入らない', async () => {
        const code = await bundleMod("import type { Ubi } from 'ubichill'; declare const Ubi: Ubi; Ubi.log('hi');");
        expectNoUbiSdk(code);
        expect(code.length).toBeLessThan(100);
    });

    it('verbatimModuleSyntax で型の import が副作用 import として残っても SDK の実装が入らない', async () => {
        const code = await bundleMod(
            "import { type Ubi } from 'ubichill'; declare const Ubi: Ubi; Ubi.log('hi');",
            { compilerOptions: { verbatimModuleSyntax: true } },
        );
        expectNoUbiSdk(code);
        expect(code.length).toBeLessThan(100);
    });

    it('JSX だけ使う mod には jsx-runtime しか入らない', async () => {
        const code = await bundleMod("console.log(<div class='a'>hi</div>);");
        expectNoUbiSdk(code);
        expect(code).toContain('__ubichill_jsx_state');
    });

    it('Gripable だけ使う mod に UbiSDK 本体が入らない', async () => {
        const code = await bundleMod(
            [
                "import type { Grip } from 'ubichill';",
                "import { Gripable } from 'ubichill/gripable';",
                'declare const grip: Grip;',
                'console.log(<Gripable grip={grip}><span>pen</span></Gripable>);',
            ].join('\n'),
        );
        expectNoUbiSdk(code);
        expect(code).toContain('data-ubi-gripable');
    });
});

describe('buildPackageJson', () => {
    it('unscoped 名 "ubichill" で、依存も bin も持たない（CLI は @ubichill/cli）', () => {
        const pkg = JSON.parse(buildPackageJson());
        expect(pkg.name).toBe('ubichill');
        expect(pkg.dependencies).toEqual({});
        expect(pkg.bin).toBeUndefined();
        expect(pkg.engines).toBeUndefined();
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
        // Host本体（AGPL-3.0-only）とは別に MIT（外部mod開発者が自分のコードへ組み込みやすいよう）
        expect(pkg.license).toBe('MIT');
        expect(pkg.exports['.'].import).toBe('./index.js');
        expect(pkg.exports['./jsx-runtime'].import).toBe('./jsx-runtime.js');
        expect(pkg.exports['./gripable'].import).toBe('./gripable.js');
        // package.json の files に LICENSE/README.md が入っている以上、実体が無いと publish が壊れる
        expect(pkg.files).toContain('LICENSE');
        expect(pkg.files).toContain('README.md');
    });

    it('packages/sdk/LICENSE が実在し MIT 表記を含む（build.mjs が dist-npm へコピーする実体）', () => {
        expect(existsSync(sdkLicensePath), 'packages/sdk/LICENSE が見つからない').toBe(true);
        expect(readFileSync(sdkLicensePath, 'utf-8')).toContain('MIT License');
    });

    it('packages/sdk/README.md は実際に存在するAPI（Ubi.state/Ubi.entity等）を説明している（旧README.mdは削除済みのuseWorld/useSocket等を紹介していた）', () => {
        const readme = readFileSync(join(__dirname, 'README.md'), 'utf-8');
        expect(readme).toMatch(/Ubi\.state/);
        expect(readme).toMatch(/Ubi\.entity/);
        expect(readme).not.toMatch(/useWorld|useSocket|WorldProvider|SocketProvider/);
    });
});
