import { useEffect, useRef } from 'react';
import { addedMessages, type ConsoleInput } from '@/lib/console/console';

/** 入力途中の参照（1 文字ごとに文が変わる）で溜まり過ぎないよう、落ち着いてから溜める */
const WARNING_SETTLE_MS = 800;

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
