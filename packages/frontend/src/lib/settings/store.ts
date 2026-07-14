/**
 * settings/store — ユーザー設定の localStorage 永続化 (純粋関数)。
 *
 * アプリ各所に散在していた localStorage 直叩きを一元化する層。
 * すべて JSON シリアライズ経由で保存し、読み取り時は任意の型ガードで検証する。
 * localStorage が使えない/壊れた値でも例外を投げず fallback を返す (堅牢性優先)。
 */

/**
 * 設定値を読み取る。
 * - キー未設定・JSON 破損・型ガード不一致のいずれでも `fallback` を返す。
 * - `validate` を渡すと、パース結果を保存対象の型 `T` として検証できる。
 */
export function readSetting<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw) as unknown;
        if (validate && !validate(parsed)) return fallback;
        return parsed as T;
    } catch {
        return fallback;
    }
}

/** 設定値を保存する。失敗 (容量超過・無効化環境等) は握りつぶす。 */
export function writeSetting<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* localStorage 失敗時は無視 */
    }
}

/** 設定値を削除する。 */
export function removeSetting(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        /* localStorage 失敗時は無視 */
    }
}
