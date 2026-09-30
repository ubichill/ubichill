/** Map に入れる。上限を超えたら、先に入れた（古い）項目から捨てる（再設定したキーは新しい項目として扱う）。 */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
    map.delete(key);
    map.set(key, value);
    for (const oldest of map.keys()) {
        if (map.size <= max) break;
        map.delete(oldest);
    }
}
