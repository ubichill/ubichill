import { describe, expect, it } from 'vitest';
import { EntityImpl } from './entity';

describe('EntityImpl', () => {
    it('getComponent は未設定なら null を返す', () => {
        const e = new EntityImpl('a');
        expect(e.getComponent('pos')).toBeNull();
    });

    it('setComponent で設定した値を getComponent で取得できる', () => {
        const e = new EntityImpl('a');
        e.setComponent('pos', { x: 1, y: 2 });
        expect(e.getComponent('pos')).toEqual({ x: 1, y: 2 });
    });

    it('hasComponent は設定済みのみ true を返す', () => {
        const e = new EntityImpl('a');
        expect(e.hasComponent('pos')).toBe(false);
        e.setComponent('pos', { x: 0, y: 0 });
        expect(e.hasComponent('pos')).toBe(true);
    });

    it('setComponent は _componentNames にも追加する（クエリの材料）', () => {
        const e = new EntityImpl('a');
        e.setComponent('pos', {});
        expect([...e._componentNames]).toEqual(['pos']);
    });

    it('removeComponent で値と名前の両方が消える', () => {
        const e = new EntityImpl('a');
        e.setComponent('pos', { x: 1 });
        e.removeComponent('pos');
        expect(e.getComponent('pos')).toBeNull();
        expect(e.hasComponent('pos')).toBe(false);
        expect([...e._componentNames]).toEqual([]);
    });

    it('setComponent で上書きしても _componentNames は重複しない', () => {
        const e = new EntityImpl('a');
        e.setComponent('pos', { x: 1 });
        e.setComponent('pos', { x: 2 });
        expect([...e._componentNames]).toEqual(['pos']);
    });

    it('setComponent / removeComponent は _onComponentChanged を発火する', () => {
        const e = new EntityImpl('a');
        let calls = 0;
        e._onComponentChanged = () => {
            calls += 1;
        };
        e.setComponent('pos', {});
        e.removeComponent('pos');
        e._reset();
        expect(calls).toBe(3);
    });
});
