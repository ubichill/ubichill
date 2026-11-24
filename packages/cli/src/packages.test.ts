import { describe, expect, it } from 'vitest';
import { projectFiles } from './packages.ts';

describe('projectFiles（ubichill init の雛形）', () => {
    it('mod の雛形は、Worker のグローバルの Ubi を公開名 ubichill の型で宣言する', () => {
        const files = projectFiles('mod', 'hello');
        expect(files['src/env.d.ts']).toBe("declare const Ubi: import('ubichill').Ubi;\n");
    });

    it('env.d.ts は import 文を持たない（持つとモジュールになり、グローバルの宣言にならない）', () => {
        const envDts = projectFiles('mod', 'hello')['src/env.d.ts'] ?? '';
        expect(envDts).not.toMatch(/^\s*(import|export)\b/m);
    });

    it('mod の雛形の tsconfig は src を対象にし、JSX と型を公開名 ubichill から取る', () => {
        const tsconfig = JSON.parse(projectFiles('mod', 'hello')['tsconfig.json'] ?? '{}');
        expect(tsconfig.include).toEqual(['src']);
        expect(tsconfig.compilerOptions.jsxImportSource).toBe('ubichill');
    });

    it('mod の雛形の build は型を確かめてからビルドする（env.d.ts が無いと最初の Ubi で落ちる順番）', () => {
        const pkg = JSON.parse(projectFiles('mod', 'hello')['package.json'] ?? '{}');
        expect(pkg.scripts.build).toMatch(/^tsc --noEmit && ubichill build/);
        expect(pkg.dependencies).toEqual({ ubichill: expect.any(String) });
    });

    it('world の雛形には Worker の型の宣言も tsconfig も置かない', () => {
        const files = projectFiles('world', 'my-world');
        expect(Object.keys(files).sort()).toEqual([
            '.github/workflows/pages.yml',
            '.gitignore',
            'README.md',
            'package.json',
            'world.yaml',
        ]);
    });

    it('mod の雛形のファイルの一覧', () => {
        expect(Object.keys(projectFiles('mod', 'hello')).sort()).toEqual([
            '.claude/skills/ubichill-mod/SKILL.md',
            '.github/workflows/pages.yml',
            '.gitignore',
            'README.md',
            'package.json',
            'prefabs/welcome.json',
            'src/env.d.ts',
            'src/hello.worker.tsx',
            'tsconfig.json',
        ]);
    });
});
