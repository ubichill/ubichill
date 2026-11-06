import { type ComponentInstance, conflictedMediaSurfaces, findMediaConflicts } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { mediaRecordOf } from './mediaSurfaceRecords';

const instance = (
    id: string,
    type: string,
    data: Record<string, unknown>,
    ownerId: string | null,
): ComponentInstance => ({
    id,
    type,
    entityId: id.split('::')[0],
    ownerId,
    lockedBy: null,
    transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
    data,
});

const fieldsOf = (type: string) =>
    type === 'vp:controls' ? { screen: { type: 'entityRef', component: 'core:media' } } : undefined;

describe('mediaRecordOf', () => {
    // ワールド定義の Component は ownerId が null。参加者が entity:create で作ると ownerId はその人になる
    const world = [
        instance('tv::0', 'core:media', {}, null),
        instance('player::controls', 'vp:controls', { screen: 'tv' }, null),
    ];

    it('ワールド定義の配線した出力が、その面に描く', () => {
        const media = findMediaConflicts(world.map(mediaRecordOf), fieldsOf);
        expect(media.owners.get('tv')?.key).toBe('player::controls');
    });

    it('参加者が tv を指す controls を作っても、面は競合にならず、作者の出力が描き続ける', () => {
        const attack = instance('evil-1', 'vp:controls', { screen: 'tv' }, 'attacker');
        const media = findMediaConflicts([...world, attack].map(mediaRecordOf), fieldsOf);
        expect(conflictedMediaSurfaces(media).size).toBe(0);
        expect(media.owners.get('tv')?.key).toBe('player::controls');
    });

    it('攻撃者の Component が部屋に残っても（退出後も）面は奪われない', () => {
        const leftovers = [1, 2, 3].map((n) => instance(`evil-${n}`, 'vp:controls', { screen: 'tv' }, `gone-${n}`));
        const media = findMediaConflicts([...world, ...leftovers].map(mediaRecordOf), fieldsOf);
        expect(media.owners.get('tv')?.key).toBe('player::controls');
    });
});
