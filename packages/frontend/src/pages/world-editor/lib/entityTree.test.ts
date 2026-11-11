import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    cloneEntitySubtree,
    findEntityPath,
    getEntityAt,
    type RefFieldsOf,
    remapEntityRefs,
    renameEntity,
} from './entityTree';

const entity = (
    id: string,
    components: InitialEntity['components'],
    children: InitialEntity[] = [],
): InitialEntity => ({ id, transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }, tags: [], components, children });

const FIELDS: Record<string, Record<string, unknown>> = {
    'vp:controls': {
        screen: { type: 'entityRef', component: 'core:media' },
        panels: { type: 'entityRefArray' },
        title: { type: 'string' },
    },
};
const fieldsOf: RefFieldsOf = (type) => FIELDS[type];

/** 操作パネル（子の tv を参照）と、外の stage を参照する配線。 */
const player = entity(
    'player',
    [{ type: 'vp:controls', data: { screen: 'tv', panels: ['tv', 'stage', 7, 'player'], title: 'tv' } }],
    [entity('tv', [{ type: 'core:media', data: {} }])],
);

describe('cloneEntitySubtree: 参照の付け替え', () => {
    it('subtree の中を指す参照はコピーの新しい id へ、外を指す参照は元のまま', () => {
        const cloned = cloneEntitySubtree(player, ['player', 'tv', 'stage'], fieldsOf);
        expect(cloned.id).toBe('player-copy');
        expect(cloned.children[0]?.id).toBe('tv-copy');
        expect(cloned.components[0]?.data).toEqual({
            screen: 'tv-copy',
            panels: ['tv-copy', 'stage', 7, 'player-copy'],
            // 参照でないフィールドは、値が id と同じ文字列でも変えない
            title: 'tv',
        });
    });

    it('元の Entity の data は書き換えない', () => {
        cloneEntitySubtree(player, ['player', 'tv'], fieldsOf);
        expect(player.components[0]?.data.screen).toBe('tv');
    });

    it('採番が既存の -copy と衝突しても、付け替え先は実際に採番した id', () => {
        const cloned = cloneEntitySubtree(player, ['player', 'tv', 'tv-copy', 'player-copy'], fieldsOf);
        expect(cloned.children[0]?.id).toBe('tv-copy-2');
        expect(cloned.components[0]?.data.screen).toBe('tv-copy-2');
    });

    it('自分自身を指す参照もコピー自身を指す', () => {
        const self = entity('loop', [{ type: 'vp:controls', data: { screen: 'loop' } }]);
        expect(cloneEntitySubtree(self, ['loop'], fieldsOf).components[0]?.data.screen).toBe('loop-copy');
    });

    it('宣言を知らない型（mod の取得前）の data は触らない', () => {
        const unknown = entity('a', [{ type: 'other:mod', data: { screen: 'a' } }]);
        expect(cloneEntitySubtree(unknown, ['a'], fieldsOf).components[0]?.data).toEqual({ screen: 'a' });
    });
});

describe('renameEntity', () => {
    const world = [
        player,
        entity(
            'stage',
            [{ type: 'vp:controls', data: { screen: 'tv', panels: ['player'] } }],
            [entity('deep', [{ type: 'vp:controls', data: { screen: 'tv' } }])],
        ),
    ];

    it('id を変え、ツリー中のどこからの参照も新しい id に付け替える', () => {
        const next = renameEntity(world, [0, 0], 'screen-1', fieldsOf);
        expect(getEntityAt(next, [0, 0])?.id).toBe('screen-1');
        expect(next[0]?.components[0]?.data).toMatchObject({
            screen: 'screen-1',
            panels: ['screen-1', 'stage', 7, 'player'],
        });
        expect(next[1]?.components[0]?.data.screen).toBe('screen-1');
        expect(getEntityAt(next, [1, 0])?.components[0]?.data.screen).toBe('screen-1');
    });

    it('参照でないフィールドの同じ文字列は変えない', () => {
        const next = renameEntity(world, [0, 0], 'screen-1', fieldsOf);
        expect(next[0]?.components[0]?.data.title).toBe('tv');
    });

    it('同じ id への改名・存在しない path は何も変えない', () => {
        expect(renameEntity(world, [0, 0], 'tv', fieldsOf)).toBe(world);
        expect(renameEntity(world, [9], 'x', fieldsOf)).toBe(world);
    });
});

describe('remapEntityRefs', () => {
    it('変わる参照が無い Component は同じオブジェクトのまま', () => {
        const world = [entity('a', [{ type: 'vp:controls', data: { screen: 'tv' } }])];
        const next = remapEntityRefs(world, new Map([['ghost', 'x']]), fieldsOf);
        expect(next[0]?.components[0]).toBe(world[0]?.components[0]);
    });
});

describe('findEntityPath', () => {
    const tree = [entity('a', []), entity('b', [], [entity('c', []), entity('d', [], [entity('e', [])])])];

    it('子孫までたどって場所を返す', () => {
        expect(findEntityPath(tree, 'e')).toEqual([1, 1, 0]);
        expect(getEntityAt(tree, [1, 1, 0])?.id).toBe('e');
    });

    it('ルートはそのまま、無ければ null', () => {
        expect(findEntityPath(tree, 'a')).toEqual([0]);
        expect(findEntityPath(tree, 'zzz')).toBeNull();
        expect(findEntityPath([], 'a')).toBeNull();
    });

    it('同じ id が複数あれば先に見つかった方（前の兄弟の子孫を優先）', () => {
        const dup = [entity('p', [], [entity('x', [])]), entity('x', [])];
        expect(findEntityPath(dup, 'x')).toEqual([0, 0]);
    });
});
