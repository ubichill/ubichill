/**
 * スモークの段を順に走らせ、どの段で落ちたかを残す。
 * 段は前の段の結果（文脈）を受けて次の文脈を返す。落ちたら以降は飛ばすが、後片付けの段（always）は必ず走らせる。
 */
export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface StepResult {
    readonly name: string;
    readonly status: StepStatus;
    readonly ms: number;
    readonly error?: string;
}

export interface Step<C> {
    readonly name: string;
    readonly run: (context: C) => Promise<C>;
    /** 前の段が落ちても走らせる（後片付け） */
    readonly always?: boolean;
    readonly timeoutMs?: number;
}

export interface StepsOutcome<C> {
    readonly context: C;
    readonly results: readonly StepResult[];
    readonly passed: boolean;
}

interface RunOptions {
    readonly now?: () => number;
    readonly defaultTimeoutMs?: number;
    readonly onResult?: (result: StepResult) => void;
}

export async function runSteps<C>(
    steps: readonly Step<C>[],
    initial: C,
    { now = Date.now, defaultTimeoutMs = 20_000, onResult = () => {} }: RunOptions = {},
): Promise<StepsOutcome<C>> {
    const start: StepsOutcome<C> = { context: initial, results: [], passed: true };
    return steps.reduce<Promise<StepsOutcome<C>>>(async (previous, step) => {
        const state = await previous;
        if (!state.passed && !step.always) {
            const skipped: StepResult = { name: step.name, status: 'skipped', ms: 0 };
            onResult(skipped);
            return { ...state, results: [...state.results, skipped] };
        }
        const startedAt = now();
        const outcome = await withTimeout(step.run(state.context), step.timeoutMs ?? defaultTimeoutMs).then(
            (context) => ({ context, error: undefined }),
            (error: unknown) => ({ context: state.context, error: describeError(error) }),
        );
        const result: StepResult =
            outcome.error === undefined
                ? { name: step.name, status: 'passed', ms: now() - startedAt }
                : { name: step.name, status: 'failed', ms: now() - startedAt, error: outcome.error };
        onResult(result);
        return {
            context: outcome.context,
            results: [...state.results, result],
            passed: state.passed && result.status === 'passed',
        };
    }, Promise.resolve(start));
}

export function formatResult(result: StepResult): string {
    const label = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP' }[result.status];
    const time = result.status === 'skipped' ? '' : ` (${result.ms}ms)`;
    const error = result.error ? `\n       ${result.error.replaceAll('\n', '\n       ')}` : '';
    return `  ${label}  ${result.name}${time}${error}`;
}

/** 最初に落ちた段（無ければ undefined）。CI のコメントに「どこで落ちたか」を出すのに使う。 */
export function firstFailure(results: readonly StepResult[]): StepResult | undefined {
    return results.find((result) => result.status === 'failed');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${ms}ms 以内に終わりませんでした`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
