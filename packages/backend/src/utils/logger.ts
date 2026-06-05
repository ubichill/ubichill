import { appConfig } from '../config';

/**
 * ロガーユーティリティ
 * 全ログに ISO 8601 タイムスタンプを前置する (K8s ログ集約で時系列が追えるように)。
 * DEBUG=true の時のみ debug ログを出力。
 */

const ts = (): string => new Date().toISOString();

export const logger = {
    debug: (...args: unknown[]) => {
        if (appConfig.debug) {
            console.log(`[${ts()}] [DEBUG]`, ...args);
        }
    },
    info: (...args: unknown[]) => {
        console.log(`[${ts()}] [INFO]`, ...args);
    },
    warn: (...args: unknown[]) => {
        console.warn(`[${ts()}] [WARN]`, ...args);
    },
    error: (...args: unknown[]) => {
        console.error(`[${ts()}] [ERROR]`, ...args);
    },
};
