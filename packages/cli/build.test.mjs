import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCliJs, buildPackageJson, CLI_RUNTIME_DEPENDENCIES } from './build.mjs';

const cliDir = dirname(fileURLToPath(import.meta.url));

describe('buildPackageJson（@ubichill/cli）', () => {
    it('bin だけを持ち、実行時依存は esbuild と yaml だけ', () => {
        const pkg = JSON.parse(buildPackageJson());
        expect(pkg.name).toBe('@ubichill/cli');
        expect(pkg.bin).toEqual({ ubichill: './cli.js' });
        expect(pkg.dependencies).toEqual(CLI_RUNTIME_DEPENDENCIES);
        expect(pkg.engines).toEqual({ node: '>=22' });
        expect(pkg.license).toBe('MIT');
        expect(pkg.main).toBeUndefined();
        expect(pkg.exports).toBeUndefined();
        expect(pkg.files).toEqual(['cli.js', 'LICENSE', 'README.md']);
    });

    it('files に挙げた LICENSE・README.md が実在する', () => {
        expect(existsSync(join(cliDir, 'LICENSE'))).toBe(true);
        expect(readFileSync(join(cliDir, 'LICENSE'), 'utf-8')).toContain('MIT License');
        expect(existsSync(join(cliDir, 'README.md'))).toBe(true);
    });
});

describe('buildCliJs（CLI 完全バンドル、esbuild/yaml のみ external）', () => {
    let code;
    beforeAll(async () => {
        code = await buildCliJs();
    });

    it('shebang が 1 行だけ（二重 shebang は Node の ESM 実行時に SyntaxError になる）', () => {
        const lines = code.split('\n');
        expect(lines[0]).toBe('#!/usr/bin/env node');
        expect(lines[1]).not.toMatch(/^#!/);
    });

    it('esbuild/yaml は bundle されず import 文で外部化されている', () => {
        expect(code).toMatch(/from ["']esbuild["']/);
        expect(code).toMatch(/from ["']yaml["']/);
        expect(code).not.toMatch(/Dynamic require of/);
    });

    it('ワークスペースのパッケージは取り込まれ、import が残らない', () => {
        expect(code).not.toMatch(/from ["']@ubichill\//);
    });

    it('サブコマンドが実際にバンドルされている', () => {
        for (const name of ['runBuild', 'runInstall', 'runUpdate', 'runVerify', 'runPublish']) {
            expect(code).toMatch(new RegExp(name));
        }
    });
});
