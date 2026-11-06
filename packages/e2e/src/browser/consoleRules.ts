/** ブラウザのコンソールに出たもの（Worker の出力も page の console に届く）と、捕まえられなかった例外。 */
export interface ConsoleEntry {
    readonly source: 'page' | 'pageerror';
    readonly type: string;
    readonly text: string;
}

/**
 * スモークを落とすコンソールの出力。mod の検証（lock・作者署名）・Worker の起動と実行の失敗と、捕まえられなかった例外。
 * それ以外の error（再接続の一時的な失敗など）はログに残すだけにする。
 */
const FATAL_PATTERNS: readonly RegExp[] = [
    /検証に失敗/,
    /署名/,
    /signature/i,
    /Worker エラー/,
    /初期化失敗/,
    /mod実行エラー/,
    /Failed to load mod/,
    /のmodが見つかりませんでした/,
];

export function fatalConsoleEntries(entries: readonly ConsoleEntry[]): ConsoleEntry[] {
    return entries.filter(
        (entry) =>
            entry.source === 'pageerror' ||
            ((entry.type === 'error' || entry.type === 'warning') &&
                FATAL_PATTERNS.some((pattern) => pattern.test(entry.text))),
    );
}

export function formatConsole(entries: readonly ConsoleEntry[]): string {
    return entries.map((entry) => `[${entry.source}:${entry.type}] ${entry.text}`).join('\n');
}
