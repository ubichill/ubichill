import type { ComponentInstance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { collectAncestorGameObjectIds, collectSubtreeGameObjectIds, isAccessible } from './entityScope';

function makeInstance(overrides: Partial<ComponentInstance> = {}): ComponentInstance {
    return {
        id: 'inst-0',
        type: 'test:test',
        entityId: 'e0',
        parentEntityId: undefined,
        ownerId: null,
        lockedBy: null,
        transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
        data: {},
        ...overrides,
    };
}

describe('isAccessible', () => {
    it('scope 内の ComponentInstance へのアクセスは許可する', () => {
        const self = makeInstance({ id: 'a', entityId: 'root' });
        const child = makeInstance({ id: 'b', entityId: 'child', parentEntityId: 'root' });
        const scopedIds = collectSubtreeGameObjectIds([self, child], 'root');
        expect(isAccessible(child, 'subtree', 'root', scopedIds)).toBe(true);
    });

    it('scope 外の ComponentInstance へのアクセスは declaredTargets が無ければ拒否する', () => {
        const self = makeInstance({ id: 'a', entityId: 'root' });
        const other = makeInstance({ id: 'x', entityId: 'unrelated' });
        const scopedIds = collectSubtreeGameObjectIds([self, other], 'root');
        expect(isAccessible(other, 'subtree', 'root', scopedIds)).toBe(false);
    });

    it('scope 外でも declaredTargets (GameObject id 集合) に含まれていれば許可する', () => {
        const self = makeInstance({ id: 'a', entityId: 'root' });
        const other = makeInstance({ id: 'x', entityId: 'unrelated' });
        const scopedIds = collectSubtreeGameObjectIds([self, other], 'root');
        expect(isAccessible(other, 'subtree', 'root', scopedIds, new Set(['unrelated']))).toBe(true);
    });

    it('自分自身 (self-update) は scope="entity" でも常に許可される', () => {
        const self = makeInstance({ id: 'a', entityId: 'root' });
        expect(isAccessible(self, 'entity', 'root', null)).toBe(true);
    });

    it('world scope なら declaredTargets が無くても常に許可する', () => {
        const far = makeInstance({ id: 'b', entityId: 'far' });
        expect(isAccessible(far, 'world', 'root', null)).toBe(true);
    });

    it('parent scope: 祖先へのアクセスは許可し、祖先でも子孫でもない対象は拒否する', () => {
        const child = makeInstance({ id: 'c', entityId: 'child', parentEntityId: 'root' });
        const parent = makeInstance({ id: 'p', entityId: 'root' });
        const stranger = makeInstance({ id: 's', entityId: 'stranger' });
        const scopedIds = collectAncestorGameObjectIds([child, parent, stranger], 'child');
        expect(isAccessible(parent, 'parent', 'child', scopedIds)).toBe(true);
        expect(isAccessible(stranger, 'parent', 'child', scopedIds)).toBe(false);
    });

    // useModWorld.ts の onUpdateEntity/onDestroyEntity は componentInstanceId (Map key) で
    // 対象を解決してから isAccessible を呼ぶ。entityId (GameObject id) とは別の識別子空間なので、
    // 「id で検索する」実装に戻さないことをここで明示しておく（過去に混同してバグを埋め込んだため）。
    it('entityRef で明示配線された scope 外 Entity への書き込み相当の判定も許可する', () => {
        const spawner = makeInstance({ id: 'sp', entityId: 'spawner', type: 'danmaku:spawner' });
        const player = makeInstance({ id: 'pl', entityId: 'player', type: 'danmaku:player' });
        const scopedIds = collectSubtreeGameObjectIds([spawner, player], 'spawner');
        expect(isAccessible(player, 'entity', 'spawner', scopedIds)).toBe(false);
        expect(isAccessible(player, 'entity', 'spawner', scopedIds, new Set(['player']))).toBe(true);
    });
});
