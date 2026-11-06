/**
 * 出来事を知らせる口。処理（ビルド・公開・dev のパイプライン）はこれだけを受け取り、どこにどう出すかは知らない。
 */
import type { Level } from './event.ts';

export interface Logger {
    /** --debug のときだけ出る。 */
    debug(message: string, detail?: string): void;
    info(message: string, detail?: string): void;
    success(message: string, detail?: string): void;
    warn(message: string, detail?: string): void;
    error(message: string, detail?: string): void;
}

export interface RecordedLog {
    readonly level: Level;
    readonly message: string;
    readonly detail?: string;
}

/** 1 つの関数で全部の level を受けるロガーを作る。 */
export function loggerFrom(write: (level: Level, message: string, detail?: string) => void): Logger {
    return {
        debug: (message, detail) => write('debug', message, detail),
        info: (message, detail) => write('info', message, detail),
        success: (message, detail) => write('success', message, detail),
        warn: (message, detail) => write('warn', message, detail),
        error: (message, detail) => write('error', message, detail),
    };
}

export const silentLogger: Logger = loggerFrom(() => undefined);

/** 受けたものを配列に残す（テスト用）。 */
export function recordingLogger(): { readonly logger: Logger; readonly entries: RecordedLog[] } {
    const entries: RecordedLog[] = [];
    const logger = loggerFrom((level, message, detail) =>
        entries.push(detail === undefined ? { level, message } : { level, message, detail }),
    );
    return { logger, entries };
}

/**
 * 指定した level の同じ行（本文と補足が同じ）を 2 回目から出さない。
 * 保存のたびのビルドで、直していない警告が毎回並んで新しい出来事を埋もれさせないように。
 */
export function onceLogger(logger: Logger, levels: readonly Level[]): Logger {
    const seen = new Set<string>();
    return loggerFrom((level, message, detail) => {
        if (levels.includes(level)) {
            const key = JSON.stringify([level, message, detail]);
            if (seen.has(key)) return;
            seen.add(key);
        }
        logger[level](message, detail);
    });
}

/** level を付け替える（例: dev サーバーでは、ビルドの細かい info を debug に落とす）。 */
export function remapLevels(logger: Logger, map: Partial<Readonly<Record<Level, Level>>>): Logger {
    return loggerFrom((level, message, detail) => logger[map[level] ?? level](message, detail));
}
