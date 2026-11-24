import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { projectFiles } from './packages.ts';

interface Step {
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
}
interface Workflow {
    on: { push: { branches: string[] }; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    concurrency: { group: string; 'cancel-in-progress': boolean };
    jobs: { publish: { env: Record<string, string>; steps: Step[] } };
}

const workflowText = (kind: 'mod' | 'world') => projectFiles(kind, 'hello')['.github/workflows/pages.yml'] ?? '';
const workflow = (kind: 'mod' | 'world') => yaml.parse(workflowText(kind)) as Workflow;
const steps = (kind: 'mod' | 'world') => workflow(kind).jobs.publish.steps;
const indexOfRun = (list: Step[], pattern: RegExp) => list.findIndex((s) => pattern.test(s.run ?? ''));

const scratch = mkdtempSync(join(tmpdir(), 'ubichill-pages-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** 公開先を決めるステップを、npx を偽物にして bash で実際に動かす。 */
function runUrlStep(env: Record<string, string>): { status: number; output: string; githubEnv: string } {
    const script = steps('mod').find((s) => s.name === '署名の鍵と公開先を確かめる')?.run ?? '';
    const bin = mkdtempSync(join(scratch, 'bin-'));
    writeFileSync(join(bin, 'npx'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'npx'), 0o755);
    const githubEnv = join(bin, 'github-env');
    writeFileSync(githubEnv, '');
    try {
        const output = execFileSync('bash', ['-e', '-c', script], {
            env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_ENV: githubEnv, ...env },
            encoding: 'utf8',
            stdio: 'pipe',
        });
        return { status: 0, output, githubEnv: readFileSync(githubEnv, 'utf8') };
    } catch (error) {
        const failed = error as { status: number; stdout: string };
        return { status: failed.status, output: failed.stdout, githubEnv: readFileSync(githubEnv, 'utf8') };
    }
}

describe('ubichill init の GitHub Pages の公開', () => {
    it.each(['mod', 'world'] as const)('%s: main への push と手動で動き、gh-pages に書く権限だけを持つ', (kind) => {
        const wf = workflow(kind);
        expect(wf.on.push.branches).toEqual(['main']);
        expect(wf.on).toHaveProperty('workflow_dispatch');
        expect(wf.permissions).toEqual({ contents: 'write' });
        // 配置と登録の途中で取り消さない
        expect(wf.concurrency['cancel-in-progress']).toBe(false);
    });

    it.each(['mod', 'world'] as const)('%s: Action はすべて commit の SHA で固定し、版を注記する', (kind) => {
        const uses = workflowText(kind)
            .split('\n')
            .filter((line) => /^\s*-?\s*uses:/.test(line));
        expect(uses.length).toBeGreaterThanOrEqual(3);
        for (const line of uses) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    });

    it.each(['mod', 'world'] as const)('%s: 秘密は Secret から読むだけで、run の中に式を埋め込まない', (kind) => {
        const text = workflowText(kind);
        const expressions = [...text.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
        expect(new Set(expressions)).toEqual(
            new Set(['secrets.UBICHILL_CREDENTIALS', 'vars.UBICHILL_PUBLIC_URL', 'secrets.GITHUB_TOKEN']),
        );
        // run に ${{ }} を書くと、値がそのままシェルに入る（環境変数で渡す）
        for (const step of steps(kind)) expect(step.run ?? '').not.toContain('${{');
        expect(workflow(kind).jobs.publish.env.UBICHILL_CREDENTIALS).toBe(`\${{ secrets.UBICHILL_CREDENTIALS }}`);
    });

    it.each(['mod', 'world'] as const)('%s: 前の版を残したまま gh-pages に足す', (kind) => {
        const deploy = steps(kind).find((s) => s.uses?.startsWith('peaceiris/actions-gh-pages@'));
        expect(deploy?.with).toMatchObject({ publish_dir: './dist', keep_files: true });
    });

    it('mod: 履歴を引き継いでビルド → 署名 → 署名の検査 → 配置 → 配置を確かめて登録、の順', () => {
        const list = steps('mod');
        const build = indexOfRun(list, /^npm run build -- --registry-url="\$PUBLIC_URL"$/);
        const sign = indexOfRun(list, /^npx ubichill publish dist --public-url="\$PUBLIC_URL"$/);
        const verify = indexOfRun(list, /ubichill verify --dist-dir=dist --require-signatures/);
        const deploy = list.findIndex((s) => s.uses?.startsWith('peaceiris/actions-gh-pages@'));
        const register = indexOfRun(list, /ubichill publish dist --public-url="\$PUBLIC_URL" --check-public/);
        expect([build, sign, verify, deploy, register].every((i) => i >= 0)).toBe(true);
        const order = [build, sign, verify, deploy, register];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(indexOfRun(list, /ubichill whoami/)).toBeLessThan(build);
    });

    it('world: ワールドに署名して dist に書き出し、確かめてから配置する（ビルドもカタログの登録も無い）', () => {
        const list = steps('world');
        const publish = indexOfRun(list, /^npx ubichill publish world\.yaml --out=dist --public-url="\$PUBLIC_URL"$/);
        const verify = indexOfRun(list, /^npx ubichill verify dist\/world\.yaml$/);
        const deploy = list.findIndex((s) => s.uses?.startsWith('peaceiris/actions-gh-pages@'));
        expect(publish).toBeGreaterThan(0);
        expect(verify).toBeGreaterThan(publish);
        expect(deploy).toBeGreaterThan(verify);
        expect(indexOfRun(list, /npm run build|--check-public/)).toBe(-1);
    });

    it.each(['mod', 'world'] as const)('%s: run のシェルは文法が正しい', (kind) => {
        for (const step of steps(kind).filter((s) => s.run)) {
            expect(() => execFileSync('bash', ['-n', '-c', step.run ?? ''], { stdio: 'pipe' })).not.toThrow();
        }
    });

    it('公開先は既定で https://<owner を小文字>.github.io/<repo>', () => {
        const result = runUrlStep({
            UBICHILL_CREDENTIALS: 'x',
            GITHUB_REPOSITORY_OWNER: 'IeYoukan',
            GITHUB_REPOSITORY: 'IeYoukan/My-Mod',
        });
        expect(result.status).toBe(0);
        expect(result.githubEnv).toBe('PUBLIC_URL=https://ieyoukan.github.io/My-Mod\n');
    });

    it('リポジトリの変数があればそれを使い、末尾の / を外す', () => {
        const result = runUrlStep({
            UBICHILL_CREDENTIALS: 'x',
            UBICHILL_PUBLIC_URL: 'https://mods.example.com/',
            GITHUB_REPOSITORY_OWNER: 'someone',
            GITHUB_REPOSITORY: 'someone/repo',
        });
        expect(result.githubEnv).toBe('PUBLIC_URL=https://mods.example.com\n');
    });

    it('Secret が無ければ、公開先を決める前に理由を出して止まる', () => {
        const result = runUrlStep({ GITHUB_REPOSITORY_OWNER: 'someone', GITHUB_REPOSITORY: 'someone/repo' });
        expect(result.status).toBe(1);
        expect(result.output).toContain('::error::Secret UBICHILL_CREDENTIALS がありません');
        expect(result.githubEnv).toBe('');
    });

    it('README に Pages の有効化と署名の鍵の Secret の手順がある（ワールドはサムネイルも）', () => {
        for (const kind of ['mod', 'world'] as const) {
            const readme = projectFiles(kind, 'hello')['README.md'] ?? '';
            expect(readme).toContain('ubichill ci create');
            expect(readme).toContain('UBICHILL_CREDENTIALS');
            expect(readme).toContain('gh-pages');
        }
        expect(projectFiles('world', 'hello')['README.md']).toContain('spec.thumbnail');
        expect(projectFiles('mod', 'hello')['README.md']).toContain('version');
    });
});
