import { describe, expect, it } from 'vitest';
import type { ColliderInstance } from './contacts.js';
import { createCollisionTracker } from './tracker.js';

function box(id: string, x: number, y: number): ColliderInstance {
    return {
        id,
        entityId: id,
        transform: { x, y, w: 10, h: 10 },
        data: {
            shape: 'rect',
            size: 'entity',
            offset: { x: 0, y: 0 },
            isTrigger: false,
            layer: 'default',
            mask: ['default'],
        },
    };
}

const APART = [box('a', 0, 0), box('b', 100, 100)];
const TOUCHING = [box('a', 0, 0), box('b', 5, 5)];

describe('createCollisionTracker', () => {
    it('触れた最初のフレームだけ entered、その後は stayed になる', () => {
        const tracker = createCollisionTracker();

        const first = tracker.step(TOUCHING);
        expect(first.entered).toHaveLength(1);
        expect(first.stayed).toHaveLength(0);

        const second = tracker.step(TOUCHING);
        expect(second.entered).toHaveLength(0);
        expect(second.stayed).toHaveLength(1);
    });

    it('離れたフレームで exited を 1 回だけ出す', () => {
        const tracker = createCollisionTracker();
        tracker.step(TOUCHING);

        const away = tracker.step(APART);
        expect(away.exited).toHaveLength(1);

        const stillAway = tracker.step(APART);
        expect(stillAway.exited).toHaveLength(0);
        expect(stillAway.entered).toHaveLength(0);
    });

    it('離れて再び触れると entered がもう一度出る', () => {
        const tracker = createCollisionTracker();
        tracker.step(TOUCHING);
        tracker.step(APART);
        expect(tracker.step(TOUCHING).entered).toHaveLength(1);
    });

    it('接触していない状態では何も起きない', () => {
        const tracker = createCollisionTracker();
        const e = tracker.step(APART);
        expect(e).toEqual({ entered: [], stayed: [], exited: [] });
    });

    it('current() で今接触している組を取り出せる', () => {
        const tracker = createCollisionTracker();
        expect(tracker.current()).toEqual([]);
        tracker.step(TOUCHING);
        expect(tracker.current()).toEqual([{ a: 'a', b: 'b' }]);
    });

    // ワールドを切り替えたのに前のワールドの接触が残っていると、
    // 存在しない Entity に対する exit が飛んでしまう。
    it('reset 後は履歴が消え、次の step が entered からやり直しになる', () => {
        const tracker = createCollisionTracker();
        tracker.step(TOUCHING);
        tracker.reset();
        expect(tracker.current()).toEqual([]);
        expect(tracker.step(TOUCHING).entered).toHaveLength(1);
    });

    it('Collider が消えた場合も exited として扱う', () => {
        const tracker = createCollisionTracker();
        tracker.step(TOUCHING);
        const e = tracker.step([box('a', 0, 0)]);
        expect(e.exited).toEqual([{ a: 'a', b: 'b' }]);
    });
});
