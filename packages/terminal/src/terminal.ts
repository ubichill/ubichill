/**
 * 書式（event・banner・error）を実際のストリームに書く層。ストリーム・環境変数・時計は受け取るので、テストでは偽物を渡す。
 * debug・info・success は stdout、warn・error は stderr（`ubichill world build > out.json` のように stdout を使うコマンドを汚さない）。
 * 色はストリームごとに決める（stdout だけをリダイレクトしても stderr の色は残る）。
 */
import { type Banner, formatBanner } from './banner.ts';
import { colorEnabled, type EnvTable, unicodeEnabled } from './env.ts';
import { formatError } from './error.ts';
import { formatEvent, type Level, type LineStyle } from './event.ts';
import { type Logger, loggerFrom } from './logger.ts';
import { createPaint, type Paint, type Tone } from './paint.ts';
import { type Symbols, symbolsFor } from './symbols.ts';

export interface OutputStream {
    write(chunk: string): unknown;
    readonly isTTY?: boolean;
}

export interface TerminalIO {
    readonly stdout: OutputStream;
    readonly stderr: OutputStream;
    readonly env: EnvTable;
    readonly platform: string;
    readonly now: () => Date;
}

export const processIO = (): TerminalIO => ({
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    platform: process.platform,
    now: () => new Date(),
});

export interface TerminalOptions {
    /** debug を出し、失敗にスタックを付ける。 */
    readonly debug: boolean;
    /** `[scope]` の色。無い範囲は cyan。 */
    readonly scopeTones?: Readonly<Record<string, Tone>>;
}

export interface ScopeOptions {
    /** 時刻を付ける（既定 true。長く動くコマンドのイベント向け）。 */
    readonly clock?: boolean;
}

export interface Terminal extends Logger {
    readonly debugEnabled: boolean;
    /** stdout 向けの塗り（自分で行を組み立てるとき）。 */
    readonly paint: Paint;
    readonly symbols: Symbols;
    /** `[name]` を付けて出すロガー。 */
    scope(name: string, options?: ScopeOptions): Logger;
    /** 書式を付けずに stdout へ 1 行（引数なしで空行）。 */
    print(text?: string): void;
    banner(banner: Banner): void;
    /** 失敗を stderr に出す。debug ならスタックも。 */
    failure(error: unknown, options?: { readonly hint?: string; readonly debugTip?: string }): void;
}

const toStderr = (level: Level): boolean => level === 'warn' || level === 'error';

export function createTerminal(io: TerminalIO, options: TerminalOptions): Terminal {
    const symbols = symbolsFor(unicodeEnabled({ platform: io.platform, env: io.env }));
    const scopeTone = (scope: string): Tone | undefined => options.scopeTones?.[scope];
    const styleFor = (stream: OutputStream): LineStyle => ({
        paint: createPaint(colorEnabled({ isTTY: stream.isTTY, env: io.env })),
        symbols,
        scopeTone,
    });
    const out = styleFor(io.stdout);
    const err = styleFor(io.stderr);

    const emit = (level: Level, message: string, detail: string | undefined, scope?: string, clock?: boolean) => {
        if (level === 'debug' && !options.debug) return;
        const stream = toStderr(level) ? io.stderr : io.stdout;
        const event = {
            level,
            message,
            ...(detail === undefined ? {} : { detail }),
            ...(scope === undefined ? {} : { scope }),
            ...(clock ? { time: io.now() } : {}),
        };
        stream.write(`${formatEvent(event, toStderr(level) ? err : out)}\n`);
    };

    return {
        ...loggerFrom((level, message, detail) => emit(level, message, detail)),
        debugEnabled: options.debug,
        paint: out.paint,
        symbols,
        scope: (name, scopeOptions) =>
            loggerFrom((level, message, detail) => emit(level, message, detail, name, scopeOptions?.clock ?? true)),
        print: (text = '') => void io.stdout.write(`${text}\n`),
        banner: (banner) => void io.stdout.write(`${formatBanner(banner, out)}\n`),
        failure: (error, failureOptions) =>
            void io.stderr.write(`${formatError(error, { debug: options.debug, ...failureOptions }, err)}\n`),
    };
}
