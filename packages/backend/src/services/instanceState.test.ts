import type { ComponentInstance } from '@ubichill/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
    clearInstanceState,
    createEntity,
    deleteEntity,
    getEntity,
    getInstanceSnapshot,
    patchEntity,
} from './instanceState';

type Input = Omit<ComponentInstance, 'id'>;

function makeInput(overrides: Partial<Input> = {}): Input {
    return {
        type: 'pen:pen',
        ownerId: null,
        lockedBy: null,
        transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
        data: {},
        ...overrides,
    };
}

// テスト間のグローバル Map 汚染を避けるため、使った instanceId を必ず掃除する。
const usedInstances = new Set<string>();
function useInstance(id: string): string {
    usedInstances.add(id);
    return id;
}

afterEach(() => {
    for (const id of usedInstances) clearInstanceState(id);
    usedInstances.clear();
});

describe('instanceState.createEntity / getEntity', () => {
    it('明示 id で作成し、getEntity で取得できる', () => {
        const iid = useInstance('i1');
        const e = createEntity(iid, { ...makeInput(), id: 'e1' });
        expect(e.id).toBe('e1');
        expect(getEntity(iid, 'e1')).toBe(e);
    });

    it('id 省略時は UUID が採番される', () => {
        const iid = useInstance('i2');
        const e = createEntity(iid, makeInput());
        expect(e.id).toMatch(/[0-9a-f-]{36}/);
    });
});

describe('instanceState.getInstanceSnapshot / patchEntity', () => {
    it('getInstanceSnapshot は全エンティティを返す', () => {
        const iid = useInstance('i3');
        createEntity(iid, { ...makeInput(), id: 'a' });
        createEntity(iid, { ...makeInput(), id: 'b' });
        expect(
            getInstanceSnapshot(iid)
                .map((e) => e.id)
                .sort(),
        ).toEqual(['a', 'b']);
    });

    it('patchEntity は transform を浅くマージし、他フィールドは置換する', () => {
        const iid = useInstance('i4');
        createEntity(iid, {
            ...makeInput(),
            id: 'a',
            transform: { x: 1, y: 2, z: 3, w: 0, h: 0, scale: 1, rotation: 0 },
        });
        const updated = patchEntity(iid, 'a', { transform: { x: 10 }, lockedBy: 'u1' });
        expect(updated?.transform.x).toBe(10);
        expect(updated?.transform.y).toBe(2); // マージされる
        expect(updated?.lockedBy).toBe('u1');
    });

    it('patchEntity は data を浅くマージする', () => {
        const iid = useInstance('i5');
        createEntity(iid, { ...makeInput(), id: 'a', data: { color: '#000', size: 4 } });
        const updated = patchEntity(iid, 'a', { data: { color: '#fff' } });
        expect(updated?.data).toEqual({ color: '#fff', size: 4 });
    });

    it('patchEntity は存在しないエンティティに null を返す', () => {
        const iid = useInstance('i6');
        expect(patchEntity(iid, 'missing', { lockedBy: 'u1' })).toBeNull();
    });
});

describe('instanceState.deleteEntity / clearInstanceState', () => {
    it('deleteEntity は削除成否を返す', () => {
        const iid = useInstance('i7');
        createEntity(iid, { ...makeInput(), id: 'a' });
        expect(deleteEntity(iid, 'a')).toBe(true);
        expect(deleteEntity(iid, 'a')).toBe(false);
        expect(getEntity(iid, 'a')).toBeUndefined();
    });

    it('clearInstanceState はインスタンス全体を消す', () => {
        const iid = useInstance('i8');
        createEntity(iid, { ...makeInput(), id: 'a' });
        clearInstanceState(iid);
        expect(getInstanceSnapshot(iid)).toEqual([]);
    });
});
