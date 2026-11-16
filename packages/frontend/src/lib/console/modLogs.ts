/**
 * mod から来たもの（sandbox の診断・Ubi.log・Worker の例外）を、コンソールの記録にする（純粋）。
 * 型は @ubichill/react に依存せず、受け取る形だけを書く。
 */
import type { ConsoleAction, ConsoleInput, ConsoleLevel } from './console';

const LEVEL: Record<'info' | 'warn' | 'error', ConsoleLevel> = { info: 'info', warn: 'warning', error: 'error' };

/** mod のログ。debug は mod を作る人が開発者ツールで見るもので、コンソールには溜めない。 */
export function modLogInput(log: {
    level: 'debug' | 'info' | 'warn' | 'error';
    modId: string;
    message: string;
}): ConsoleInput | null {
    if (log.level === 'debug') return null;
    return { level: LEVEL[log.level], source: log.modId || 'mod', message: log.message };
}

/** sandbox の診断（権限の拒否・プロトコルの不一致など）。拒否を許可に変えられるなら、その操作を付ける。 */
export function diagnosticInput(
    diagnostic: { level: 'warn' | 'error'; modId: string; code: string; message: string },
    action?: ConsoleAction,
): ConsoleInput {
    return {
        level: LEVEL[diagnostic.level],
        source: diagnostic.modId || 'mod',
        message: diagnostic.message,
        detail: `コード: ${diagnostic.code}`,
        ...(action ? { action } : {}),
    };
}
