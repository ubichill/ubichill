import { describe, expect, it } from 'vitest';
import { setBounded } from './boundedMap';

describe('setBounded（キーを変え続けられてもメモリを増やさない）', () => {
    it('上限を超えたら古い項目から捨て、同じキーの再設定は新しい項目として扱う', () => {
        const map = new Map<string, number>();
        for (const [i, k] of ['a', 'b', 'c'].entries()) setBounded(map, k, i, 3);
        setBounded(map, 'a', 10, 3);
        setBounded(map, 'd', 11, 3);
        expect([...map.keys()]).toEqual(['c', 'a', 'd']);
        expect(map.get('a')).toBe(10);
    });
});
