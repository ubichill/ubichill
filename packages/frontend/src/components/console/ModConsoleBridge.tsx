import { resetModLogHandler, setModLogHandler } from '@ubichill/react';
import { useEffect } from 'react';
import { logConsole } from '@/lib/console/consoleStore';
import { modLogInput } from '@/lib/console/modLogs';

/** mod のログ（Ubi.log・Worker の console・Worker の例外）をコンソールに溜める。アプリ全体で 1 つ置く。 */
export function ModConsoleBridge() {
    useEffect(() => {
        setModLogHandler((log) => {
            const input = modLogInput(log);
            if (input) logConsole(input);
            else console.debug(`[Mod:${log.modId}] ${log.message}`);
        });
        return () => resetModLogHandler();
    }, []);
    return null;
}
