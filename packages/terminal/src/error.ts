/**
 * 失敗の表し方。ふだんは「何が起きたか」と「どうすればよいか（hint）」だけを出し、スタックは --debug のときだけ出す。
 *
 *   ✗ listen EADDRINUSE: address already in use 127.0.0.1:3333
 *     原因: ...
 *     ➜ 別のポートを --port=<n> で指定してください
 */
import { inspect } from 'node:util';
import type { LineStyle } from './event.ts';

/** 直し方の案内を持つエラー。投げる側が直し方を知っているときに使う。 */
export class HintedError extends Error {
    readonly hint: string;
    constructor(message: string, hint: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'HintedError';
        this.hint = hint;
    }
}

export interface ErrorView {
    readonly message: string;
    readonly hint?: string;
    /** `cause` を辿った順のメッセージ。 */
    readonly causes: readonly string[];
    /** AggregateError の中身。 */
    readonly errors: readonly string[];
    /** スタックの `at ...` の行（エラー本体と cause の分。メッセージの行は含まない）。 */
    readonly frames: readonly string[];
}

/** cause を辿る深さの上限（自分を cause にした循環や、異常に深い連鎖で止まらないように）。 */
const MAX_CAUSES = 5;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** 1 つの値のメッセージ。Error でなくても読める形にする（文字列・オブジェクト・undefined を投げるコードもある）。 */
export function messageOf(value: unknown): string {
    if (value instanceof Error) return value.message || value.name || 'Error';
    if (typeof value === 'string') return value;
    if (isRecord(value) && typeof value.message === 'string' && value.message !== '') return value.message;
    return inspect(value, { depth: 2, breakLength: Number.POSITIVE_INFINITY });
}

const framesOf = (value: unknown): string[] =>
    value instanceof Error && typeof value.stack === 'string'
        ? value.stack
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.startsWith('at '))
        : [];

function causeChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    const seen = new Set<unknown>([error]);
    const step = (value: unknown): void => {
        if (!isRecord(value) || !('cause' in value) || value.cause === undefined) return;
        if (seen.has(value.cause) || chain.length >= MAX_CAUSES) return;
        seen.add(value.cause);
        chain.push(value.cause);
        step(value.cause);
    };
    step(error);
    return chain;
}

export function describeError(error: unknown): ErrorView {
    const causes = causeChain(error);
    const hint = isRecord(error) && typeof error.hint === 'string' && error.hint !== '' ? error.hint : undefined;
    return {
        message: messageOf(error),
        ...(hint ? { hint } : {}),
        causes: causes.map(messageOf),
        errors: error instanceof AggregateError ? error.errors.map(messageOf) : [],
        frames: [error, ...causes].flatMap(framesOf),
    };
}

export interface FormatErrorOptions {
    /** スタックを出す。 */
    readonly debug: boolean;
    /** エラーが持つ hint より優先する案内。 */
    readonly hint?: string;
    /** debug でないときに末尾へ薄く出す一言（例: 「--debug で詳しく」）。 */
    readonly debugTip?: string;
}

export function formatError(error: unknown, options: FormatErrorOptions, { paint, symbols }: LineStyle): string {
    const view = describeError(error);
    const [head = '', ...rest] = view.message.replace(/\s+$/, '').split(/\r?\n/);
    const hint = options.hint ?? view.hint;
    const lines = [
        `${paint('red', symbols.error)} ${paint(['red', 'bold'], head)}`,
        ...rest.map((line) => (line.trim() === '' ? '' : `  ${line}`)),
        ...view.errors.map((message) => `  - ${message}`),
        ...view.causes.map((message) => `  ${paint('dim', '原因:')} ${message}`),
        ...(hint ? [`  ${paint('cyan', symbols.arrow)} ${hint}`] : []),
        ...(options.debug
            ? view.frames.map((frame) => paint('dim', `    ${frame}`))
            : options.debugTip
              ? [paint('dim', `  ${options.debugTip}`)]
              : []),
    ];
    return lines.join('\n');
}
