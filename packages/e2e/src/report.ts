import { isRecord } from './http.ts';

/** スモークの 1 段（API・ブラウザ）の結果。CI はこれを JSON で受け取り、プレビューのコメントに載せる。 */
export interface SuiteReport {
    readonly suite: 'api' | 'browser';
    readonly status: 'passed' | 'failed';
    readonly ms: number;
    /** 最初に落ちた段と理由（1 行） */
    readonly failedStep?: string;
}

export interface SmokeSummary {
    readonly passed: boolean;
    readonly suites: Partial<Record<SuiteReport['suite'], SuiteReport>>;
}

export function summarize(reports: readonly SuiteReport[]): SmokeSummary {
    return {
        passed: reports.every((report) => report.status === 'passed'),
        suites: Object.fromEntries(reports.map((report) => [report.suite, report])),
    };
}

/** Playwright の JSON レポートから、最初に落ちた test.step の名前と理由の 1 行目。 */
export function firstFailureOfPlaywright(json: string): string | undefined {
    const report: unknown = JSON.parse(json);
    const results = collectResults(report);
    const step = results.flatMap((result) => failedSteps(result.steps))[0];
    if (step) return `${step.title}: ${firstLine(step.message)}`;
    const error = results.flatMap((result) => result.errors)[0];
    if (error) return firstLine(error);
    const global = isRecord(report) && Array.isArray(report.errors) ? report.errors.map(errorMessage) : [];
    return global[0] ? firstLine(global[0]) : undefined;
}

interface PlaywrightResult {
    readonly steps: unknown[];
    readonly errors: string[];
}

function collectResults(node: unknown): PlaywrightResult[] {
    if (!isRecord(node)) return [];
    const own = Array.isArray(node.results)
        ? node.results.filter(isRecord).map((result) => ({
              steps: Array.isArray(result.steps) ? result.steps : [],
              errors: Array.isArray(result.errors) ? result.errors.map(errorMessage) : [],
          }))
        : [];
    const children = ['suites', 'specs', 'tests'].flatMap((key) => {
        const value = node[key];
        return Array.isArray(value) ? value.flatMap(collectResults) : [];
    });
    return [...own, ...children];
}

function failedSteps(steps: unknown[]): { title: string; message: string }[] {
    return steps.filter(isRecord).flatMap((step) => {
        if (!isRecord(step.error)) return [];
        const title = typeof step.title === 'string' ? step.title : '(名前のない段)';
        return [{ title, message: errorMessage(step.error) }];
    });
}

function errorMessage(error: unknown): string {
    if (!isRecord(error)) return String(error);
    return typeof error.message === 'string' ? error.message : JSON.stringify(error);
}

function firstLine(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Playwright のエラーは色の制御文字を含む
    const plain = text.replace(/\u001b\[[0-9;]*m/g, '');
    return (plain.split('\n').find((line) => line.trim() !== '') ?? plain).trim();
}
