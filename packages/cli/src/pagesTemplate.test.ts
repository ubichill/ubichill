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
    env?: Record<string, string>;
}
interface Workflow {
    on: { push: { branches: string[] }; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    concurrency: { group: string; 'cancel-in-progress': boolean };
    jobs: { publish: { env?: Record<string, string>; permissions: Record<string, string>; steps: Step[] } };
}

const workflowText = (kind: 'mod' | 'world') => projectFiles(kind, 'hello')['.github/workflows/pages.yml'] ?? '';
const workflow = (kind: 'mod' | 'world') => yaml.parse(workflowText(kind)) as Workflow;
const steps = (kind: 'mod' | 'world') => workflow(kind).jobs.publish.steps;
const indexOfRun = (list: Step[], pattern: RegExp) => list.findIndex((s) => pattern.test(s.run ?? ''));

const scratch = mkdtempSync(join(tmpdir(), 'ubichill-pages-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * 名前のステップを bash で実際に動かす。npx は偽物で、呼ばれるたびに npxExits の終了コードを順に返す（無ければ 0）。
 * sleep も偽物にして待たない。
 */
function runStep(
    name: string,
    env: Record<string, string>,
    npxExits: number[] = [],
    kind: 'mod' | 'world' = 'mod',
): { status: number; output: string; githubEnv: string; npxCalls: number } {
    const script = steps(kind).find((s) => s.name === name)?.run ?? '';
    const bin = mkdtempSync(join(scratch, 'bin-'));
    const calls = join(bin, 'calls');
    writeFileSync(calls, '');
    writeFileSync(
        join(bin, 'npx'),
        `#!/bin/sh\necho x >> "${calls}"\nn=$(wc -l < "${calls}")\ncodes="${npxExits.join(' ')}"\ncode=$(echo "$codes" | cut -d' ' -f$n)\nexit \${code:-0}\n`,
    );
    writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    for (const file of ['npx', 'sleep']) chmodSync(join(bin, file), 0o755);
    const githubEnv = join(bin, 'github-env');
    writeFileSync(githubEnv, '');
    const read = () => ({
        githubEnv: readFileSync(githubEnv, 'utf8'),
        npxCalls: readFileSync(calls, 'utf8').split('\n').filter(Boolean).length,
    });
    try {
        const output = execFileSync('bash', ['-e', '-c', script], {
            env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_ENV: githubEnv, ...env },
            encoding: 'utf8',
            stdio: 'pipe',
        });
        return { status: 0, output, ...read() };
    } catch (error) {
        const failed = error as { status: number; stdout: string };
        return { status: failed.status, output: failed.stdout, ...read() };
    }
}
const runUrlStep = (env: Record<string, string>) => runStep('署名の鍵と公開先を確かめる', env);

describe('ubichill init の GitHub Pages の公開', () => {
    it.each(['mod', 'world'] as const)('%s: main への push と手動で動き、gh-pages に書く権限だけを持つ', (kind) => {
        const wf = workflow(kind);
        expect(wf.on.push.branches).toEqual(['main']);
        expect(wf.on).toHaveProperty('workflow_dispatch');
        // 書く権限は配置するジョブにだけ
        expect(wf.permissions).toEqual({});
        expect(wf.jobs.publish.permissions).toEqual({ contents: 'write' });
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
    });

    it.each(['mod', 'world'] as const)(
        '%s: 署名の鍵は ubichill を動かすステップにだけ渡し、依存の install スクリプトと git に認証を渡さない',
        (kind) => {
            const wf = workflow(kind);
            expect(wf.jobs.publish.env).toBeUndefined();
            for (const step of wf.jobs.publish.steps) {
                const needs = /npx ubichill (whoami|publish)/.test(step.run ?? '');
                expect(step.env?.UBICHILL_CREDENTIALS !== undefined).toBe(needs);
            }
            expect(wf.jobs.publish.steps.find((s) => s.uses?.startsWith('actions/checkout@'))?.with).toEqual({
                'persist-credentials': false,
            });
            const install = wf.jobs.publish.steps.find((s) => s.run?.startsWith('npm ci'));
            expect(install?.run).toBe('npm ci --ignore-scripts');
            expect(install?.env).toBeUndefined();
        },
    );

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
        const register = indexOfRun(
            list,
            /ubichill publish dist --public-url="\$PUBLIC_URL" --check-public --require-registration/,
        );
        expect([build, sign, verify, deploy, register].every((i) => i >= 0)).toBe(true);
        const order = [build, sign, verify, deploy, register];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(indexOfRun(list, /ubichill whoami/)).toBeLessThan(build);
    });

    it('world: 署名して dist に書き出し → 確かめる → 配置 → 登録（作者のサーバーが止まっていても配置は止めない）', () => {
        const list = steps('world');
        const publish = indexOfRun(list, /^npx ubichill publish world\.yaml --out=dist$/);
        const verify = indexOfRun(list, /^npx ubichill verify dist\/world\.yaml$/);
        const deploy = list.findIndex((s) => s.uses?.startsWith('peaceiris/actions-gh-pages@'));
        const register = indexOfRun(
            list,
            /npx ubichill publish world\.yaml --out=\.ubichill\/register --public-url="\$PUBLIC_URL" --no-install --require-registration/,
        );
        expect(publish).toBeGreaterThan(0);
        expect(verify).toBeGreaterThan(publish);
        expect(deploy).toBeGreaterThan(verify);
        expect(register).toBeGreaterThan(deploy);
        // 配置より前に登録しない
        expect(list.slice(0, deploy).some((s) => /--public-url/.test(s.run ?? ''))).toBe(false);
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

    it('登録: 公開先をまだ確かめられない（終了コード 1）あいだは待ってやり直し、確かめられたら成功', () => {
        const result = runStep('登録する', { PUBLIC_URL: 'https://a.github.io/m' }, [1, 1, 0]);
        expect(result.status).toBe(0);
        expect(result.npxCalls).toBe(3);
        expect(result.output).toContain('少し待ってやり直します（2/10）');
    });

    it('登録: 登録できなかった（終了コード 2）ら、やり直さずにすぐ失敗にする', () => {
        const result = runStep('登録する', { PUBLIC_URL: 'https://a.github.io/m' }, [2]);
        expect(result.status).toBe(1);
        expect(result.npxCalls).toBe(1);
        expect(result.output).toContain('::error::登録できませんでした');
    });

    it('登録: 10 回確かめられなければ、Pages の設定を案内して失敗にする', () => {
        const result = runStep('登録する', { PUBLIC_URL: 'https://a.github.io/m' }, Array(10).fill(1));
        expect(result.status).toBe(1);
        expect(result.npxCalls).toBe(10);
        expect(result.output).toContain('gh-pages ブランチを選んでいるか');
    });

    it('world: 登録も一時的な失敗（1）はやり直し、やり直しても通らない失敗（2）ですぐ止める', () => {
        const env = { PUBLIC_URL: 'https://a.github.io/w' };
        expect(runStep('登録する', env, [1, 0], 'world')).toMatchObject({ status: 0, npxCalls: 2 });
        expect(runStep('登録する', env, [2], 'world')).toMatchObject({ status: 1, npxCalls: 1 });
    });

    it('README に Pages の有効化と署名の鍵の Secret の手順がある（ワールドはサムネイルも）', () => {
        for (const kind of ['mod', 'world'] as const) {
            const readme = projectFiles(kind, 'hello')['README.md'] ?? '';
            expect(readme).toContain('ubichill ci create');
            expect(readme).toContain('UBICHILL_CREDENTIALS');
            expect(readme).toContain('gh-pages');
            expect(readme).toContain('--require-registration');
        }
        expect(projectFiles('world', 'hello')['README.md']).toContain('spec.thumbnail');
        expect(projectFiles('mod', 'hello')['README.md']).toContain('version');
    });
});
