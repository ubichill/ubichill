/**
 * 1 つの出来事を 1 行にする（CLI の結果・dev サーバーのイベント）。
 *
 *   12:01:03 [build] ✓ video-player を作り直しました  120 ms  世代 4a3f-2
 *   ^時刻(dim) ^範囲   ^記号 ^本文                    ^補足(dim)
 *
 * 時刻と範囲は任意（1 回で終わるコマンドは付けない）。本文が複数行なら 2 行目以降を本文の頭に揃えて字下げする。
 */
import { formatClock } from './format.ts';
import type { Paint, Tone } from './paint.ts';
import type { Symbols } from './symbols.ts';
import { displayWidth } from './width.ts';

export type Level = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface LogEvent {
    readonly level: Level;
    readonly message: string;
    /** 本文の後ろに薄く付ける補足（かかった時間・ID など）。 */
    readonly detail?: string;
    /** `[dev]` のような出どころ。 */
    readonly scope?: string;
    readonly time?: Date;
}

export interface LineStyle {
    readonly paint: Paint;
    readonly symbols: Symbols;
    /** 範囲ごとの色（無ければ cyan）。 */
    readonly scopeTone?: (scope: string) => Tone | undefined;
}

const LEVEL_TONE: Readonly<Record<Level, Tone | undefined>> = {
    debug: 'dim',
    info: undefined,
    success: undefined,
    warn: 'yellow',
    error: 'red',
};

function marker(level: Level, { paint, symbols }: LineStyle): string {
    if (level === 'success') return paint('green', symbols.success);
    if (level === 'warn') return paint('yellow', symbols.warn);
    if (level === 'error') return paint('red', symbols.error);
    return '';
}

const joinNonEmpty = (parts: readonly string[]): string => parts.filter((part) => part !== '').join(' ');

export function formatEvent(event: LogEvent, style: LineStyle): string {
    const { paint } = style;
    const [head = '', ...rest] = event.message.replace(/\s+$/, '').split(/\r?\n/);
    const scopeTone = event.scope === undefined ? undefined : (style.scopeTone?.(event.scope) ?? 'cyan');
    const prefix = joinNonEmpty([
        event.time ? paint('dim', formatClock(event.time)) : '',
        event.scope === undefined
            ? ''
            : event.level === 'debug'
              ? paint('dim', `[${event.scope}]`)
              : paint([scopeTone ?? 'cyan', 'bold'], `[${event.scope}]`),
        marker(event.level, style),
    ]);
    const tone = LEVEL_TONE[event.level];
    const detail = event.detail ? `  ${paint('dim', event.detail)}` : '';
    const first = joinNonEmpty([prefix, tone ? paint(tone, head) : head]) + detail;
    const indent = ' '.repeat(prefix === '' ? 0 : displayWidth(prefix) + 1);
    const continuation = rest.map((line) => (line.trim() === '' ? '' : `${indent}${line}`));
    return [first, ...continuation].join('\n');
}
