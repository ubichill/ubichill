export type ConsoleLevel = 'error' | 'warning' | 'info';

export interface ConsoleEntry {
    id: number;
    level: ConsoleLevel;
    /** どの操作で出たか（ビルド・公開・参照 など） */
    source: string;
    message: string;
    /** 最後に出た時刻 (epoch ms) */
    at: number;
    /** 直前と同じ内容が続いた回数 */
    count: number;
}

export type ConsoleInput = Pick<ConsoleEntry, 'level' | 'source' | 'message'>;

/** 溜める上限。古いものから捨てる。 */
export const CONSOLE_LIMIT = 300;

/** 直前と同じ内容なら回数だけ増やし、違えば末尾に足す。 */
export function appendConsole(entries: readonly ConsoleEntry[], input: ConsoleInput, at: number): ConsoleEntry[] {
    const last = entries.at(-1);
    if (last && last.level === input.level && last.source === input.source && last.message === input.message) {
        return [...entries.slice(0, -1), { ...last, at, count: last.count + 1 }];
    }
    return [...entries, { ...input, id: (last?.id ?? 0) + 1, at, count: 1 }].slice(-CONSOLE_LIMIT);
}

export function consoleCounts(entries: readonly ConsoleEntry[]): Record<ConsoleLevel, number> {
    const total = (level: ConsoleLevel) =>
        entries.filter((entry) => entry.level === level).reduce((sum, entry) => sum + entry.count, 0);
    return { error: total('error'), warning: total('warning'), info: total('info') };
}

const LEVEL_LABEL: Record<ConsoleLevel, string> = { error: 'ERROR', warning: 'WARN', info: 'INFO' };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 端末のローカル時刻で HH:MM:SS。 */
export function formatConsoleTime(at: number): string {
    const date = new Date(at);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 貼り付け先（issue・チャット）で読める 1 行。 */
export function formatConsoleEntry(entry: ConsoleEntry): string {
    const repeat = entry.count > 1 ? ` (x${entry.count})` : '';
    return `[${formatConsoleTime(entry.at)}] ${LEVEL_LABEL[entry.level]} ${entry.source}: ${entry.message}${repeat}`;
}

export function formatConsole(entries: readonly ConsoleEntry[]): string {
    return entries.map(formatConsoleEntry).join('\n');
}

/** next にあって prev に無い文。前から出ている警告をもう一度溜めないために使う。 */
export function addedMessages(prev: readonly string[], next: readonly string[]): string[] {
    const before = new Set(prev);
    return [...new Set(next)].filter((message) => !before.has(message));
}
