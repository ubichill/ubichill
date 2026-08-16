import { describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from './types';
import { EcsWorldImpl } from './world';

describe('EcsWorldImpl.createEntity / getEntity', () => {
    it('createEntity した entity を getEntity で取得できる', () => {
        const world = new EcsWorldImpl();
        const e = world.createEntity('a');
        expect(world.getEntity('a')).toBe(e);
    });

    it('存在しない id は null を返す', () => {
        const world = new EcsWorldImpl();
        expect(world.getEntity('nope')).toBeNull();
    });

    it('同じ id を二重に create すると例外を投げる', () => {
        const world = new EcsWorldImpl();
        world.createEntity('a');
        expect(() => world.createEntity('a')).toThrow(/already exists/);
    });
});

describe('EcsWorldImpl.registerSystem / tick', () => {
    it('tick が全 system に entities・deltaTime・events を渡す', () => {
        const world = new EcsWorldImpl();
        const a = world.createEntity('a');
        const sys = vi.fn();
        world.registerSystem(sys);
        const events: WorkerEvent[] = [{ type: 'input:mouse_move' }];
        world.tick(0.016, events);
        expect(sys).toHaveBeenCalledTimes(1);
        expect(sys).toHaveBeenCalledWith([a], 0.016, events);
    });

    it('tick は登録順に system を呼ぶ', () => {
        const world = new EcsWorldImpl();
        const order: string[] = [];
        world.registerSystem(() => {
            order.push('first');
        });
        world.registerSystem(() => {
            order.push('second');
        });
        world.tick(0);
        expect(order).toEqual(['first', 'second']);
    });
});

describe('EcsWorldImpl.query', () => {
    it('component 名に一致する entity だけを返す', () => {
        const world = new EcsWorldImpl();
        const withPos = world.createEntity('a');
        withPos.setComponent('pos', { x: 0, y: 0 });
        world.createEntity('b'); // pos 無し
        const result = world.query(['pos']).execute();
        expect(result).toEqual([withPos]);
    });

    it('複数 component は AND 条件（全て持つ entity のみ）', () => {
        const world = new EcsWorldImpl();
        const both = world.createEntity('a');
        both.setComponent('pos', {});
        both.setComponent('vel', {});
        const onlyPos = world.createEntity('b');
        onlyPos.setComponent('pos', {});
        expect(world.query(['pos', 'vel']).execute()).toEqual([both]);
    });

    it('同じ key の query はキャッシュされた同じインスタンスを返す', () => {
        const world = new EcsWorldImpl();
        const q1 = world.query(['pos', 'vel']);
        const q2 = world.query(['vel', 'pos']); // 順序が違っても同一 key
        expect(q1).toBe(q2);
    });

    it('既存 entity の component 変更は保持した query.execute() に反映される', () => {
        const world = new EcsWorldImpl();
        const e = world.createEntity('a');
        const q = world.query(['pos']);
        expect(q.execute()).toEqual([]);

        e.setComponent('pos', { x: 1 });
        // 保持した Query を経由しても、component 追加が反映されるべき（鮮度）
        expect(q.execute()).toEqual([e]);
    });

    it('新規 entity は world.query() を再取得すれば反映される（スナップショット契約）', () => {
        const world = new EcsWorldImpl();
        const q = world.query(['pos']);
        const e = world.createEntity('a');
        e.setComponent('pos', {});
        expect(world.query(['pos']).execute()).toEqual([e]);
        // 古いスナップショットは新規 entity を知らない（ドキュメント目的）
        expect(q.execute()).toEqual([]);
    });
});

describe('EcsWorldImpl.clear', () => {
    it('entities・systems・query キャッシュをすべて空にする', () => {
        const world = new EcsWorldImpl();
        world.createEntity('a');
        world.registerSystem(() => {});
        world.query(['pos']);

        world.clear();
        expect(world.getEntity('a')).toBeNull();
        // tick しても system が呼ばれない
        const sys = vi.fn();
        world.registerSystem(sys);
        world.tick(0);
        expect(sys).toHaveBeenCalledWith([], 0, []);
    });
});
