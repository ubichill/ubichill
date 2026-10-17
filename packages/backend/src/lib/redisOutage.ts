export interface OutageLog {
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
}

export interface RedisOutage {
    /** Redis に頼る操作が失敗した。落ちてから最初の 1 回だけ警告する。 */
    failed(err: unknown): void;
    /** 成功した。落ちていたなら戻ったことを 1 回だけ記録する。 */
    succeeded(): void;
}

/**
 * Redis が落ちている間、リクエストや掃除のたびに同じ警告を出さないための記録。機能ごとに作る（何が止まっているかを出す）。
 * @param feature 機能の名前（例: `HTTP のレート制限（global）`）
 * @param whileDown 落ちている間の振る舞い（例: `制限せずに通します`）
 */
export function redisOutage(feature: string, whileDown: string, log: OutageLog): RedisOutage {
    const state = { down: false };
    return {
        failed: (err) => {
            if (state.down) return;
            state.down = true;
            log.warn(`Redis が使えません。${feature}: ${whileDown}`, err instanceof Error ? err.message : err);
        },
        succeeded: () => {
            if (!state.down) return;
            state.down = false;
            log.info(`Redis が戻りました。${feature}を元に戻します`);
        },
    };
}
