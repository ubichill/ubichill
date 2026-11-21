import { describe, expect, it } from 'vitest';
import { hiddenGameObjects } from './visibility';

describe('hiddenGameObjects', () => {
    const nodes = [
        { entityId: 'house' },
        { entityId: 'door', parentEntityId: 'house' },
        { entityId: 'door', parentEntityId: 'house' },
        { entityId: 'knob', parentEntityId: 'door' },
        { entityId: 'sign' },
        {},
    ];

    it('見えない親の子孫も見えない。兄弟と親は見える', () => {
        expect(hiddenGameObjects(nodes, new Set(['door']))).toEqual(new Set(['door', 'knob']));
        expect(hiddenGameObjects(nodes, new Set(['house']))).toEqual(new Set(['house', 'door', 'knob']));
        expect(hiddenGameObjects(nodes, new Set())).toEqual(new Set());
    });

    it('部屋に無い ID は数えない', () => {
        expect(hiddenGameObjects(nodes, new Set(['ghost']))).toEqual(new Set());
    });

    it('親が輪になっていても止まる', () => {
        const loop = [
            { entityId: 'a', parentEntityId: 'b' },
            { entityId: 'b', parentEntityId: 'a' },
            { entityId: 'c', parentEntityId: 'a' },
        ];
        expect(hiddenGameObjects(loop, new Set())).toEqual(new Set());
        expect(hiddenGameObjects(loop, new Set(['b']))).toEqual(new Set(['a', 'b', 'c']));
    });
});
