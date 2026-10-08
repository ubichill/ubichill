import { describe, expect, it } from 'vitest';
import { buildStroke, ERASER_SIZE_SCALE, type StrokePoint, strokeFingerprint } from './stroke';

const pen = { color: '#ff0000', strokeWidth: 4, eraser: false };
const eraser = { ...pen, eraser: true };
const line: StrokePoint[] = [
    [0, 0, 1],
    [10, 10, 1],
    [20, 5, 1],
];

describe('buildStroke', () => {
    it('点が 1 つ以下ならストロークにしない（クリックだけで何も消さない）', () => {
        expect(buildStroke([], pen)).toBeNull();
        expect(buildStroke([[1, 1, 1]], eraser)).toBeNull();
    });

    it('ペンは色と太さをそのまま使い、mode を付けない（古い Host でも同じ線になる）', () => {
        expect(buildStroke(line, pen)).toEqual({ points: line, color: '#ff0000', size: 4 });
    });

    it('消しゴムは erase で、ペンの色に左右されず、太さを広げる', () => {
        const stroke = buildStroke(line, eraser);
        expect(stroke?.mode).toBe('erase');
        expect(stroke?.size).toBe(4 * ERASER_SIZE_SCALE);
        expect(buildStroke(line, { ...eraser, color: '#00ff00' })).toEqual(stroke);
    });

    it('元の点の配列を共有しない（描画中の配列への追加が確定済みのストロークに漏れない）', () => {
        const points = line.slice();
        const stroke = buildStroke(points, pen);
        points.push([99, 99, 1]);
        expect(stroke?.points).toHaveLength(3);
    });
});

describe('strokeFingerprint', () => {
    it('同じストロークは同じ指紋になる', () => {
        const stroke = buildStroke(line, pen);
        expect(stroke && strokeFingerprint(stroke)).toBe(stroke && strokeFingerprint({ ...stroke }));
    });

    it('同じ座標・色・太さでも、消しゴムと線は別のストロークとして扱う', () => {
        const drawn = { points: line, color: '#000000', size: 16 };
        expect(strokeFingerprint(drawn)).not.toBe(strokeFingerprint({ ...drawn, mode: 'erase' }));
    });

    it('mode 省略は draw と同じ（古いデータとの照合が崩れない）', () => {
        const drawn = { points: line, color: '#000000', size: 4 };
        expect(strokeFingerprint(drawn)).toBe(strokeFingerprint({ ...drawn, mode: 'draw' }));
    });

    it('始点と点数が同じでも終点が違えば別のストローク', () => {
        const a = { points: line, color: '#000000', size: 4 };
        const b = { ...a, points: [line[0], line[1], [30, 30, 1]] as StrokePoint[] };
        expect(strokeFingerprint(a)).not.toBe(strokeFingerprint(b));
    });
});
