/**
 * コンソール（Unity の Console を手本にした、エラー・警告・情報の記録）。ワールドの画面と編集画面で共通。
 * 読み込めなかった mod・mod が出したログ・編集の操作の結果を、画面に通知を出さずにここへ溜める。
 * ここは純粋な関数だけ。溜める場所は consoleStore、表示は components/console。
 */

export type ConsoleLevel = 'error' | 'warning' | 'info';

/** 並び（ツールバーの切り替え・件数の表示の順）。 */
export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['error', 'warning', 'info'];

/** 行に付ける操作（読み込めなかった mod の再試行・拒否した権限の許可）。 */
export interface ConsoleAction {
    label: string;
    run: () => void;
}

export interface ConsoleEntry {
    id: number;
    level: ConsoleLevel;
    /** 出どころ（mod の ID・公開・参照 など） */
    source: string;
    message: string;
    /** 詳細の欄だけに出す補足（理由のコード・直し方） */
    detail?: string;
    action?: ConsoleAction;
    /** 最後に出た時刻 (epoch ms) */
    at: number;
    /** 直前と同じ内容が続いた回数 */
    count: number;
}

export type ConsoleInput = Pick<ConsoleEntry, 'level' | 'source' | 'message' | 'detail' | 'action'>;

/** 溜める上限。古いものから捨てる。 */
export const CONSOLE_LIMIT = 300;

type Content = Pick<ConsoleEntry, 'level' | 'source' | 'message' | 'detail'>;

const contentKey = (entry: Content) => JSON.stringify([entry.level, entry.source, entry.message, entry.detail ?? '']);

/**
 * 直前と同じ内容なら回数だけ増やし、違えば末尾に足す。
 * `lastId` はクリアする前に振った最後の ID（クリアしたあとも ID を使い回さない）。
 */
export function appendConsole(
    entries: readonly ConsoleEntry[],
    input: ConsoleInput,
    at: number,
    lastId = 0,
): ConsoleEntry[] {
    const last = entries.at(-1);
    if (last && contentKey(last) === contentKey(input)) {
        return [...entries.slice(0, -1), { ...last, action: input.action ?? last.action, at, count: last.count + 1 }];
    }
    const id = Math.max(last?.id ?? 0, lastId) + 1;
    return [...entries, { ...input, id, at, count: 1 }].slice(-CONSOLE_LIMIT);
}

export function consoleCounts(entries: readonly ConsoleEntry[]): Record<ConsoleLevel, number> {
    const total = (level: ConsoleLevel) =>
        entries.filter((entry) => entry.level === level).reduce((sum, entry) => sum + entry.count, 0);
    return { error: total('error'), warning: total('warning'), info: total('info') };
}

/**
 * Unity の Collapse。離れて出た同じ内容も 1 行にまとめて回数を足す。
 * 並びは最初に出た順。時刻と操作は最後に出たものを使う（操作は新しいほうが今の状態に合う）。
 */
export function collapseConsole(entries: readonly ConsoleEntry[]): ConsoleEntry[] {
    const groups = entries.reduce((map, entry) => {
        const key = contentKey(entry);
        const seen = map.get(key);
        return map.set(
            key,
            seen
                ? { ...seen, at: entry.at, count: seen.count + entry.count, action: entry.action ?? seen.action }
                : entry,
        );
    }, new Map<string, ConsoleEntry>());
    return [...groups.values()];
}

/** 最後に出たエラーか警告（画面の下の帯に出す。情報は出さない）。 */
export function latestProblem(entries: readonly ConsoleEntry[]): ConsoleEntry | undefined {
    return entries.findLast((entry) => entry.level !== 'info');
}

/** 表示の条件（ツールバーの状態）。 */
export interface ConsoleView {
    /** 出す種類 */
    levels: Readonly<Record<ConsoleLevel, boolean>>;
    collapse: boolean;
    query: string;
}

export const DEFAULT_CONSOLE_VIEW: ConsoleView = {
    levels: { error: true, warning: true, info: true },
    collapse: false,
    query: '',
};

/** 出す行。検索は文・出どころ・補足の部分一致（大文字小文字を区別しない）。 */
export function visibleConsole(entries: readonly ConsoleEntry[], view: ConsoleView): ConsoleEntry[] {
    const query = view.query.trim().toLowerCase();
    const matches = (entry: ConsoleEntry) =>
        !query || [entry.message, entry.source, entry.detail ?? ''].some((text) => text.toLowerCase().includes(query));
    return (view.collapse ? collapseConsole(entries) : entries).filter(
        (entry) => view.levels[entry.level] && matches(entry),
    );
}

/** 件数の表示。桁が増えてもツールバーの幅が動かないよう 999 で止める。 */
export function formatConsoleCount(count: number): string {
    return count > 999 ? '999+' : String(count);
}

const LEVEL_LABEL: Record<ConsoleLevel, string> = { error: 'ERROR', warning: 'WARN', info: 'INFO' };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 端末のローカル時刻で HH:MM:SS。 */
export function formatConsoleTime(at: number): string {
    const date = new Date(at);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 貼り付け先（issue・チャット）で読める形。補足は字下げして続ける。 */
export function formatConsoleEntry(entry: ConsoleEntry): string {
    const repeat = entry.count > 1 ? ` (x${entry.count})` : '';
    const head = `[${formatConsoleTime(entry.at)}] ${LEVEL_LABEL[entry.level]} ${entry.source}: ${entry.message}${repeat}`;
    if (!entry.detail) return head;
    return [head, ...entry.detail.split('\n').map((line) => `    ${line}`)].join('\n');
}

export function formatConsole(entries: readonly ConsoleEntry[]): string {
    return entries.map(formatConsoleEntry).join('\n');
}

/** next にあって prev に無い文。前から出ている警告をもう一度溜めないために使う。 */
export function addedMessages(prev: readonly string[], next: readonly string[]): string[] {
    const before = new Set(prev);
    return [...new Set(next)].filter((message) => !before.has(message));
}
