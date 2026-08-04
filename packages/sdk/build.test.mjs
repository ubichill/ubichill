import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCliJs, buildJs, buildPackageJson, ENTRIES } from './build.mjs';

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
});

describe('buildPackageJson', () => {
    it('unscoped 名 "ubichill" で import surface は自己完結、bin（CLI）だけ real dependency を持つ', () => {
        const pkg = JSON.parse(buildPackageJson());
        expect(pkg.name).toBe('ubichill');
        // esbuild/yaml は cli.js 側だけが external にしている実行時依存（bundleすると
        // Dynamic require エラーで実行時に落ちるため、real dependency として残す必要がある）。
        expect(pkg.dependencies).toEqual({ esbuild: '^0.28.0', yaml: '^2.5.0' });
        expect(pkg.bin).toEqual({ ubichill: './cli.js' });
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
        // Host本体（AGPL-3.0-only）とは別に MIT（外部mod開発者が自分のコードへ組み込みやすいよう）
        expect(pkg.license).toBe('MIT');
        expect(pkg.exports['.'].import).toBe('./index.js');
        expect(pkg.exports['./jsx-runtime'].import).toBe('./jsx-runtime.js');
        expect(pkg.exports['./gripable'].import).toBe('./gripable.js');
        // package.json の files に LICENSE が入っている以上、実体が無いと publish が壊れる
        expect(pkg.files).toContain('LICENSE');
    });

    it('packages/sdk/LICENSE が実在し MIT 表記を含む（build.mjs が dist-npm へコピーする実体）', () => {
        expect(existsSync(sdkLicensePath), 'packages/sdk/LICENSE が見つからない').toBe(true);
        expect(readFileSync(sdkLicensePath, 'utf-8')).toContain('MIT License');
    });
});

describe('buildCliJs（CLI 完全バンドル、esbuild/yaml のみ external）', () => {
    let code;
    beforeAll(async () => {
        code = await buildCliJs();
    });

    it('shebang が1行だけ（二重shebangはNodeのESM実行時にSyntaxErrorになるため実測済みで禁止）', () => {
        const lines = code.split('\n');
        expect(lines[0]).toBe('#!/usr/bin/env node');
        expect(lines[1]).not.toMatch(/^#!/);
    });

    it('esbuild/yaml は bundle されず import 文で外部化されている（native binary/動的requireの解決崩壊を防ぐ）', () => {
        expect(code).toMatch(/from ["']esbuild["']/);
        expect(code).toMatch(/from ["']yaml["']/);
        // esbuild本体のソース（native binaryをrequireするコード等）が混入していないことの傍証
        expect(code).not.toMatch(/Dynamic require of/);
    });

    it('build/lock/verify サブコマンドが実際にバンドルされている', () => {
        expect(code).toMatch(/runBuild/);
        // lock サブコマンドの実体は @ubichill/loader の runGenLock（lock.ts が `as runLock` で
        // re-export するが、bundle後は元の宣言名 runGenLock に解決される。実測済み）。
        expect(code).toMatch(/runGenLock/);
        expect(code).toMatch(/runVerify/);
    });
});
