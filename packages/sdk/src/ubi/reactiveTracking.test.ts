import { describe, expect, it } from 'vitest';
import { createReadTracker, type KeyDescriptor } from './reactiveTracking';

function makeDescriptor(): KeyDescriptor {
    return { subscribe: () => {}, unsubscribe: () => {} };
}

describe('createReadTracker', () => {
    it('追跡中でなければ recordRead は何もしない（例外も投げない）', () => {
        const tracker = createReadTracker();
        expect(() => tracker.recordRead(makeDescriptor())).not.toThrow();
    });

    it('begin→record→end で読んだ descriptor の集合を返す（重複は1つにまとまる）', () => {
        const tracker = createReadTracker();
        tracker.beginTrackingReads();
        const d1 = makeDescriptor();
        const d2 = makeDescriptor();
        tracker.recordRead(d1);
        tracker.recordRead(d2);
        tracker.recordRead(d1);
        const result = tracker.endTrackingReads();
        expect(result.size).toBe(2);
        expect(result.has(d1)).toBe(true);
        expect(result.has(d2)).toBe(true);
    });

    it('スタックが空のまま endTrackingReads を呼ぶと空集合を返す（例外を投げない）', () => {
        const tracker = createReadTracker();
        expect(tracker.endTrackingReads()).toEqual(new Set());
    });

    it('ネストした begin/end はLIFOで独立した集合を保つ', () => {
        const tracker = createReadTracker();
        tracker.beginTrackingReads();
        const outer = makeDescriptor();
        tracker.recordRead(outer);

        tracker.beginTrackingReads();
        const inner = makeDescriptor();
        tracker.recordRead(inner);
        const innerResult = tracker.endTrackingReads();
        expect(innerResult.has(inner)).toBe(true);
        expect(innerResult.has(outer)).toBe(false);

        // 内側の end 後、外側の追跡フレームに戻って続けて記録できる
        tracker.recordRead(outer);
        const outerResult = tracker.endTrackingReads();
        expect(outerResult.has(outer)).toBe(true);
        expect(outerResult.size).toBe(1);
    });

    it('end を呼ばずに次の begin を呼んでもクラッシュしない（リーク検知は呼び出し側の責務）', () => {
        // createReadTracker 自身は try/finally を強制しない薄いスタックであることの確認。
        // 実際のリーク防止は ui/index.ts の renderUi が try/finally で担う。
        const tracker = createReadTracker();
        tracker.beginTrackingReads();
        tracker.recordRead(makeDescriptor());
        // end を呼ばずに次の begin ...
        tracker.beginTrackingReads();
        const result = tracker.endTrackingReads();
        expect(result.size).toBe(0); // 新しいフレームは空から始まる

        // 元のフレーム（1件記録済み）がまだスタックに残っている
        const leaked = tracker.endTrackingReads();
        expect(leaked.size).toBe(1);
    });

    it('複数の createReadTracker() インスタンスは互いに独立している（モジュール単一状態ではない）', () => {
        const a = createReadTracker();
        const b = createReadTracker();

        a.beginTrackingReads();
        const da = makeDescriptor();
        a.recordRead(da);

        // b はまだ begin していないので、a の記録は b に影響しない
        expect(() => b.recordRead(makeDescriptor())).not.toThrow();
        expect(b.endTrackingReads().size).toBe(0);

        const resultA = a.endTrackingReads();
        expect(resultA.size).toBe(1);
        expect(resultA.has(da)).toBe(true);
    });
});
