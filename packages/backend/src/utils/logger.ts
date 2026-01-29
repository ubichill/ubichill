import { appConfig } from '../config';

/**
 * ロガーユーティリティ
 * DEBUG環境変数がtrueの場合のみデバッグログを出力
 */

export const logger = {
    /**
     * デバッグログ（DEBUG=trueの場合のみ出力）
     */
    debug: (...args: unknown[]) => {
        if (appConfig.debug) {
            console.log('[DEBUG]', ...args);
        }
    },

    /**
     * 情報ログ（常に出力）
     */
    info: (...args: unknown[]) => {
        console.log(...args);
    },

    /**
     * 警告ログ（常に出力）
     */
    warn: (...args: unknown[]) => {
        console.warn(...args);
    },

    /**
     * エラーログ（常に出力）
     */
    error: (...args: unknown[]) => {
        console.error(...args);
    },
};
