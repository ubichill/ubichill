import { useCallback, useEffect, useRef, useState } from 'react';
import { addedMessages, appendConsole, type ConsoleEntry, type ConsoleInput } from '../lib/editorConsole';

/** 入力途中の参照（1 文字ごとに文が変わる）で溜まり過ぎないよう、落ち着いてから溜める */
const WARNING_SETTLE_MS = 800;

/** エディタのコンソール。エラー・警告・操作の結果をこの画面を開いている間だけ溜める。 */
export function useEditorConsole() {
    const [entries, setEntries] = useState<ConsoleEntry[]>([]);
    const log = useCallback((input: ConsoleInput) => {
        setEntries((prev) => appendConsole(prev, input, Date.now()));
    }, []);
    const clear = useCallback(() => setEntries([]), []);
    return { entries, log, clear };
}

/** 今出ている警告のうち、新しく出たものだけをコンソールへ溜める。 */
export function useLogNewWarnings(
    warnings: ReadonlyArray<{ source: string; message: string }>,
    log: (input: ConsoleInput) => void,
) {
    const logged = useRef<readonly string[]>([]);
    useEffect(() => {
        const timer = setTimeout(() => {
            const current = warnings.map((w) => w.message);
            for (const message of addedMessages(logged.current, current)) {
                const source = warnings.find((w) => w.message === message)?.source ?? 'エディタ';
                log({ level: 'warning', source, message });
            }
            logged.current = current;
        }, WARNING_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [warnings, log]);
}
