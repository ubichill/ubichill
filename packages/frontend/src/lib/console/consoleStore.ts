import { appendConsole, type ConsoleEntry, type ConsoleInput, type ConsoleLevel } from './console';

export interface ConsoleStore {
    log: (input: ConsoleInput) => void;
    clear: () => void;
    getEntries: () => readonly ConsoleEntry[];
    subscribe: (listener: () => void) => () => void;
}

interface ConsoleStoreOptions {
    now?: () => number;
    /** 知らせを遅らせる先。同じ処理の中の記録は 1 回の知らせにまとめる（mod が続けてログを出しても描き直しは 1 回） */
    schedule?: (run: () => void) => void;
    /** 溜めたものを、ブラウザの開発者ツールにも出す */
    mirror?: (input: ConsoleInput) => void;
}

export function createConsoleStore(options: ConsoleStoreOptions = {}): ConsoleStore {
    const now = options.now ?? Date.now;
    const schedule = options.schedule ?? queueMicrotask;
    const state: { entries: readonly ConsoleEntry[]; lastId: number; pending: boolean } = {
        entries: [],
        lastId: 0,
        pending: false,
    };
    const listeners = new Set<() => void>();
    const notify = () => {
        if (state.pending) return;
        state.pending = true;
        schedule(() => {
            state.pending = false;
            for (const listener of listeners) listener();
        });
    };
    return {
        log: (input) => {
            options.mirror?.(input);
            state.entries = appendConsole(state.entries, input, now(), state.lastId);
            state.lastId = state.entries.at(-1)?.id ?? state.lastId;
            notify();
        },
        clear: () => {
            if (state.entries.length === 0) return;
            state.entries = [];
            notify();
        },
        getEntries: () => state.entries,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

const DEVTOOLS: Record<ConsoleLevel, 'error' | 'warn' | 'info'> = { error: 'error', warning: 'warn', info: 'info' };

/**
 * アプリ全体で 1 つのコンソール。React の外（mod の診断・ログのハンドラー）からも書ける。
 * 部屋に入り直したとき・編集画面を開いたときに空にする。
 */
export const appConsole = createConsoleStore({
    mirror: ({ level, source, message }) => console[DEVTOOLS[level]](`[${source}] ${message}`),
});

export const logConsole = appConsole.log;
