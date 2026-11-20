import { describe, expect, it } from 'vitest';
import { movedServers } from './featuredServerOrder';

describe('並べるサーバーの並べ替え', () => {
    it('隣と入れ替える。端を越える・範囲外は元のまま（元の配列は変えない）', () => {
        const list = ['a', 'b', 'c'];
        expect(movedServers(list, 1, -1)).toEqual(['b', 'a', 'c']);
        expect(movedServers(list, 1, 1)).toEqual(['a', 'c', 'b']);
        expect(movedServers(list, 0, -1)).toEqual(['a', 'b', 'c']);
        expect(movedServers(list, 2, 1)).toEqual(['a', 'b', 'c']);
        expect(movedServers(list, 5, -1)).toEqual(['a', 'b', 'c']);
        expect(list).toEqual(['a', 'b', 'c']);
    });
});
