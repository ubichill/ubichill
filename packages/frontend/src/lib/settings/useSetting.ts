import { useCallback, useState } from 'react';
import { readSetting, writeSetting } from './store';

/** useState と同じく、値そのものか前の値からの更新関数を受け取る。 */
type SetSetting<T> = (next: T | ((prev: T) => T)) => void;

/**
 * localStorage で永続化される設定値の React フック。
 *
 * `useState` のドロップイン代替。初期値は保存済みの値 (無ければ fallback) から復元し、
 * setter を呼ぶたびに保存する。関数アップデータ (`set(prev => next)`) も使える。
 * `validate` で保存値の型を検証できる。
 *
 * @returns `[value, setValue]` — setValue の参照は key が変わらない限り安定。
 */
export function useSetting<T>(
    key: string,
    fallback: T,
    validate?: (value: unknown) => value is T,
): readonly [T, SetSetting<T>] {
    const [value, setValue] = useState<T>(() => readSetting(key, fallback, validate));

    const set = useCallback<SetSetting<T>>(
        (next) => {
            setValue((prev) => {
                const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
                writeSetting(key, resolved);
                return resolved;
            });
        },
        [key],
    );

    return [value, set] as const;
}
