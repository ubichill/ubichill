/**
 * Go のインスタンスサーバーのログを dev サーバーの行にする。
 *
 * Go は `--log-format=json` で 1 行に 1 つの JSON（slog の JSONHandler: `time`・`level`・`msg` と属性）を stderr に書く。
 * JSON でない行（panic のスタック・起動前のエラー・古いバイナリ）はそのまま出す。捨てると落ちた理由が分からなくなる。
 */
import type { Logger } from '@ubichill/terminal';

export type GoLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type GoLogLine =
    | { readonly kind: 'record'; readonly level: GoLogLevel; readonly message: string; readonly attrs: string }
    | { readonly kind: 'raw'; readonly text: string };

/** 属性にしない slog の鍵（時刻は dev サーバーが自分の時計で付ける）。 */
const RESERVED_KEYS = new Set(['time', 'level', 'msg']);

/**
 * slog の level の文字列。間の level は `INFO+2`・`DEBUG-4` の形になるので、名前の部分で決める。
 * 知らない名前は info（出すかどうかを info と同じに扱う）。
 */
export function goLevelOf(value: unknown): GoLogLevel {
    const name = typeof value === 'string' ? value.trim().toUpperCase().split(/[+-]/)[0] : '';
    if (name === 'DEBUG') return 'debug';
    if (name === 'WARN' || name === 'WARNING') return 'warn';
    if (name === 'ERROR') return 'error';
    return 'info';
}

/** logfmt の値（空白・引用符・`=` を含む文字列は JSON の文字列にする）。 */
function attrValue(value: unknown): string {
    if (typeof value === 'string') return value === '' || /[\s"=]/.test(value) ? JSON.stringify(value) : value;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? String(value);
}

/** 属性を `key=value` で並べる。slog のグループ（入れ子のオブジェクト）は `group.key` に開く。 */
export function formatAttrs(attrs: Readonly<Record<string, unknown>>, prefix = ''): string {
    return Object.entries(attrs)
        .flatMap(([key, value]) =>
            typeof value === 'object' && value !== null && !Array.isArray(value)
                ? [formatAttrs(value as Record<string, unknown>, `${prefix}${key}.`)]
                : [`${prefix}${key}=${attrValue(value)}`],
        )
        .filter((part) => part !== '')
        .join(' ');
}

/** 1 行を読む。空行は null。 */
export function parseGoLogLine(line: string): GoLogLine | null {
    const text = line.replace(/\s+$/, '');
    if (text.trim() === '') return null;
    const parsed = (() => {
        if (!text.trimStart().startsWith('{')) return undefined;
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return undefined;
        }
    })();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'raw', text };
    const record = parsed as Record<string, unknown>;
    if (typeof record.msg !== 'string') return { kind: 'raw', text };
    const attrs = Object.fromEntries(Object.entries(record).filter(([key]) => !RESERVED_KEYS.has(key)));
    return { kind: 'record', level: goLevelOf(record.level), message: record.msg, attrs: formatAttrs(attrs) };
}

/** 注意と失敗はいつも、info と debug は --debug のときだけ出す。JSON でない行はいつも出す。 */
export const shouldShowGoLine = (line: GoLogLine, debug: boolean): boolean =>
    debug || line.kind === 'raw' || line.level === 'warn' || line.level === 'error';

export function reportGoLine(line: GoLogLine, log: Logger): void {
    if (line.kind === 'raw') {
        log.info(line.text);
        return;
    }
    const detail = line.attrs === '' ? undefined : line.attrs;
    log[line.level](line.message, detail);
}

/** Go に渡す引数。ログは JSON で、--debug でなければ warn より上だけを書かせる（出さない行を作らせない）。 */
export function goArgs(input: { readonly port: number; readonly origins: readonly string[]; readonly debug: boolean }) {
    return [
        '--guests',
        `--listen=127.0.0.1:${input.port}`,
        `--origins=${input.origins.join(',')}`,
        '--log-format=json',
        `--log-level=${input.debug ? 'debug' : 'warn'}`,
    ];
}
