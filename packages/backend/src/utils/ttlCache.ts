import { setBounded } from './boundedMap';

/**
 * 期限付きの結果キャッシュ。結果ではなく Promise を持つので、同じキーの同時の呼び出しは 1 回の処理にまとまる。
 * 失敗した処理はキャッシュしない（次の呼び出しでやり直す）。項目数に上限があり、超えたら古いものから捨てる。
 */
export function createTtlCache<V>(options: { ttlMs: number; max: number; now?: () => number }) {
    const now = options.now ?? Date.now;
    const entries = new Map<string, { at: number; value: Promise<V> }>();
    return {
        getOrCreate(key: string, create: () => Promise<V>): Promise<V> {
            const hit = entries.get(key);
            if (hit && now() - hit.at < options.ttlMs) return hit.value;
            const value = create();
            setBounded(entries, key, { at: now(), value }, options.max);
            value.catch(() => {
                if (entries.get(key)?.value === value) entries.delete(key);
            });
            return value;
        },
        delete(key: string): void {
            entries.delete(key);
        },
    };
}
