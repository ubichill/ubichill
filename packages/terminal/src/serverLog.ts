/**
 * サーバー（backend・db の migrate）のログ。本番は Kubernetes で TTY ではないので、色を付けず、1 つの出来事を必ず 1 行にする
 * （ログの集約は行ごとに 1 件と数える。スタックの改行は `\n` と書いて同じ行に残す）。手元の端末では時刻を短くして色を付ける。
 *
 *   2026-11-06T03:01:03.123Z INFO  [config] ポート=3001 環境=production
 *   2026-11-06T03:01:04.456Z ERROR ワールド取得エラー: Error: boom\n    at ...
 */
import { inspect } from 'node:util';
import { colorEnabled, type EnvTable } from './env.ts';
import { formatClock } from './format.ts';
import { createPaint, type Paint, stripAnsi, type Tone } from './paint.ts';

export type ServerLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
    readonly time: Date;
    readonly level: ServerLevel;
    readonly scope?: string;
    /** console.log と同じく、文字列はそのまま、それ以外は 1 行で inspect して空白で繋ぐ。 */
    readonly args: readonly unknown[];
}

export interface ServerLineStyle {
    readonly paint: Paint;
    /** 端末に出す（時刻を短く・複数行を許す）。false なら本番の形（ISO 時刻・1 行）。 */
    readonly tty: boolean;
}

const LEVEL_TONE: Readonly<Record<ServerLevel, Tone>> = { debug: 'gray', info: 'cyan', warn: 'yellow', error: 'red' };

const LEVEL_WIDTH = 'ERROR'.length;

const renderArg = (arg: unknown): string =>
    typeof arg === 'string' ? arg : inspect(arg, { depth: 4, breakLength: Number.POSITIVE_INFINITY, colors: false });

const timestamp = (time: Date): string => (Number.isNaN(time.getTime()) ? '-' : time.toISOString());

/** 改行を `\n` の 2 文字にする（1 行に保つ）。制御符号は消す（ライブラリが色を付けた文字列も本番では素にする）。 */
export const toSingleLine = (text: string): string => stripAnsi(text).replace(/\r\n|\r|\n/g, '\\n');

export function formatLogRecord(record: LogRecord, { paint, tty }: ServerLineStyle): string {
    const body = record.args.map(renderArg).join(' ');
    const head = [
        tty ? paint('dim', formatClock(record.time)) : timestamp(record.time),
        paint(LEVEL_TONE[record.level], record.level.toUpperCase().padEnd(LEVEL_WIDTH)),
        record.scope ? (tty ? paint('cyan', `[${record.scope}]`) : `[${record.scope}]`) : '',
    ]
        .filter((part) => part !== '')
        .join(' ');
    if (!tty) return `${head} ${toSingleLine(body)}`;
    const [first = '', ...rest] = body.split(/\r?\n/);
    const tone = record.level === 'error' ? 'red' : record.level === 'debug' ? 'dim' : undefined;
    return [`${head} ${tone ? paint(tone, first) : first}`, ...rest.map((line) => `    ${line}`)].join('\n');
}

export interface ServerLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    /** `[scope]` を付けたロガー。 */
    child(scope: string): ServerLogger;
}

export interface ServerSink {
    /** debug・info の 1 行。 */
    out(line: string): void;
    /** warn・error の 1 行。 */
    err(line: string): void;
}

export interface ServerLoggerOptions {
    readonly scope?: string;
    /** debug を出すか（呼ぶたびに読む。設定を読み込む前に作ったロガーでも、後から決まった値に従う）。 */
    readonly debug?: () => boolean;
    readonly sink?: ServerSink;
    readonly now?: () => Date;
    /** 端末に出しているか（既定は stdout が TTY か）。 */
    readonly tty?: boolean;
    readonly env?: EnvTable;
}

/** console に書く（テストの console の差し替えがそのまま効く）。 */
const consoleSink: ServerSink = {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
};

export function createServerLogger(options: ServerLoggerOptions = {}): ServerLogger {
    const tty = options.tty ?? process.stdout.isTTY === true;
    const style: ServerLineStyle = {
        paint: createPaint(colorEnabled({ isTTY: tty, env: options.env ?? process.env })),
        tty,
    };
    const sink = options.sink ?? consoleSink;
    const now = options.now ?? (() => new Date());
    const debug = options.debug ?? (() => false);
    const write = (level: ServerLevel, args: readonly unknown[]): void => {
        if (level === 'debug' && !debug()) return;
        const line = formatLogRecord({ time: now(), level, scope: options.scope, args }, style);
        if (level === 'warn' || level === 'error') sink.err(line);
        else sink.out(line);
    };
    return {
        debug: (...args) => write('debug', args),
        info: (...args) => write('info', args),
        warn: (...args) => write('warn', args),
        error: (...args) => write('error', args),
        child: (scope) =>
            createServerLogger({ ...options, scope: options.scope ? `${options.scope}:${scope}` : scope }),
    };
}
