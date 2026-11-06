/**
 * CLI 全体の出力の決まりごと: --debug の読み取り、範囲の色、版、失敗したときの表し方。書式そのものは @ubichill/terminal。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    colorEnabled,
    createPaint,
    createTerminal,
    DEBUG_ENV,
    debugFromEnv,
    type Paint,
    processIO,
    type Terminal,
    type TerminalIO,
    type Tone,
} from '@ubichill/terminal';

export const DEBUG_FLAG = '--debug';

/** 全体のフラグを取り除く（サブコマンドの前でも後ろでも効く）。 */
export function splitGlobalFlags(argv: readonly string[]): { readonly debug: boolean; readonly args: string[] } {
    return { debug: argv.includes(DEBUG_FLAG), args: argv.filter((arg) => arg !== DEBUG_FLAG) };
}

/** dev サーバーのイベントの出どころの色（どこで起きたかを色で見分ける）。 */
export const SCOPE_TONES: Readonly<Record<string, Tone>> = {
    dev: 'cyan',
    build: 'magenta',
    instance: 'blue',
    http: 'gray',
};

export function createCliTerminal(debugFlag: boolean, io: TerminalIO = processIO()): Terminal {
    return createTerminal(io, { debug: debugFlag || debugFromEnv(io.env), scopeTones: SCOPE_TONES });
}

/** stderr に自分で組み立てた行を書くときの塗り。 */
export const stderrPaint = (): Paint => createPaint(colorEnabled({ isTTY: process.stderr.isTTY, env: process.env }));

export const DEBUG_TIP = `${DEBUG_FLAG}（または ${DEBUG_ENV}=1）を付けるとスタックトレースを表示します`;

/** CLI の不具合らしい失敗か（使い方の誤りではなく、--debug で調べてもらうもの）。 */
export const isLikelyBug = (error: unknown): boolean =>
    error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError;

/** `startDir` から上へ辿って、`name` の package.json の version を探す（ソースでもバンドルでも、置き場所に依らない）。 */
export function findPackageVersion(
    startDir: string,
    name: string,
    readText: (path: string) => string | undefined,
): string | undefined {
    const text = readText(join(startDir, 'package.json'));
    const parsed = (() => {
        try {
            return text === undefined ? undefined : (JSON.parse(text) as { name?: unknown; version?: unknown });
        } catch {
            return undefined;
        }
    })();
    if (parsed?.name === name && typeof parsed.version === 'string') return parsed.version;
    const parent = dirname(startDir);
    return parent === startDir ? undefined : findPackageVersion(parent, name, readText);
}

export const cliVersion = (): string | undefined =>
    findPackageVersion(dirname(fileURLToPath(import.meta.url)), '@ubichill/cli', (path) => {
        try {
            return readFileSync(path, 'utf-8');
        } catch {
            return undefined;
        }
    });
