import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { newRunId } from './account.ts';
import { runApiSmoke } from './apiSmoke.ts';
import { firstFailureOfPlaywright, type SuiteReport, summarize } from './report.ts';
import { firstFailure, formatResult } from './steps.ts';
import { resolveTarget, type SmokeTarget } from './target.ts';

const USAGE = `使い方: pnpm smoke <画面の URL> [--api=<API の URL>] [--suite=all|api|browser] [--world=default]
                  [--report=<json>] [--artifacts=<dir>]
  例: pnpm smoke https://pr-123.ubichill.com
      pnpm smoke http://localhost:3000            （API は http://localhost:3001 とみなす）
      pnpm smoke http://localhost:3200 --api=http://localhost:3201 --suite=api`;

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// pnpm smoke（--filter 経由）は cwd を packages/e2e に変える。相対パスは呼んだ場所から読む
const callerDir = process.env.INIT_CWD ?? process.cwd();

async function main(): Promise<number> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            api: { type: 'string' },
            suite: { type: 'string', default: 'all' },
            world: { type: 'string', default: 'default' },
            report: { type: 'string' },
            artifacts: { type: 'string', default: join(packageDir, 'smoke-results') },
            help: { type: 'boolean', default: false },
        },
    });
    if (values.help) {
        console.log(USAGE);
        return 0;
    }
    const target = resolveTarget(positionals[0], values.api);
    const suite = values.suite;
    if (suite !== 'all' && suite !== 'api' && suite !== 'browser') throw new Error(`--suite が不正です: ${suite}`);
    const runId = newRunId(Date.now(), Math.random);
    const artifacts = resolve(callerDir, values.artifacts);
    await mkdir(artifacts, { recursive: true });
    console.log(
        `スモーク: ${target.origin}（API ${target.apiOrigin}、run ${runId}、テスト用アカウントは smoke_${runId}_*）`,
    );

    const api = suite === 'browser' ? undefined : await apiSuite(target, runId, values.world);
    const browser = suite === 'api' ? undefined : await browserSuite(target, runId, values.world, artifacts);
    const reports = [api, browser].filter((report): report is SuiteReport => report !== undefined);

    if (values.report)
        await writeFile(resolve(callerDir, values.report), `${JSON.stringify(summarize(reports), null, 2)}\n`);
    return reports.every((report) => report.status === 'passed') ? 0 : 1;
}

async function apiSuite(target: SmokeTarget, runId: string, worldId: string): Promise<SuiteReport> {
    console.log('\n[API と WebSocket]');
    const startedAt = Date.now();
    const outcome = await runApiSmoke({
        target,
        runId,
        worldId,
        onResult: (result) => console.log(formatResult(result)),
    });
    const failed = firstFailure(outcome.results);
    return {
        suite: 'api',
        status: outcome.passed ? 'passed' : 'failed',
        ms: Date.now() - startedAt,
        failedStep: failed ? `${failed.name}: ${failed.error ?? ''}` : undefined,
    };
}

async function browserSuite(
    target: SmokeTarget,
    runId: string,
    worldId: string,
    artifacts: string,
): Promise<SuiteReport> {
    console.log('\n[ブラウザ]');
    const startedAt = Date.now();
    const jsonReport = join(artifacts, 'playwright-report.json');
    const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');
    const code = await new Promise<number>((resolvePromise, reject) => {
        const child = spawn(
            process.execPath,
            [
                playwrightCli,
                'test',
                'src/browser/smoke.spec.ts',
                '--reporter=list,json',
                `--output=${join(artifacts, 'browser')}`,
                '--workers=1',
                '--retries=0',
                '--timeout=120000',
            ],
            {
                cwd: packageDir,
                stdio: 'inherit',
                env: {
                    ...process.env,
                    SMOKE_ORIGIN: target.origin,
                    SMOKE_API_ORIGIN: target.apiOrigin,
                    SMOKE_RUN_ID: runId,
                    SMOKE_WORLD: worldId,
                    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReport,
                },
            },
        );
        child.on('error', reject);
        child.on('exit', (exitCode) => resolvePromise(exitCode ?? 1));
    });
    const failedStep =
        code === 0 ? undefined : await readFile(jsonReport, 'utf8').then(firstFailureOfPlaywright, () => undefined);
    return {
        suite: 'browser',
        status: code === 0 ? 'passed' : 'failed',
        ms: Date.now() - startedAt,
        failedStep: code === 0 ? undefined : (failedStep ?? 'Playwright が失敗しました（ログを見てください）'),
    };
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        console.error(USAGE);
        process.exitCode = 2;
    },
);
