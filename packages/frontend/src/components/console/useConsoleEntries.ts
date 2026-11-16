import { useSyncExternalStore } from 'react';
import type { ConsoleEntry } from '@/lib/console/console';
import { appConsole, type ConsoleStore } from '@/lib/console/consoleStore';

export function useConsoleEntries(store: ConsoleStore = appConsole): readonly ConsoleEntry[] {
    return useSyncExternalStore(store.subscribe, store.getEntries);
}
