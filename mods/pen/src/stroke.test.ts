import { describe, expect, it } from 'vitest';
import {
    buildStroke,
    ERASER_FALLBACK_COLOR,
    ERASER_SIZE_SCALE,
    extendStroke,
    MAX_STROKE_POINTS,
    MAX_STROKE_SIZE,
    MAX_STROKE_WIDTH,
    parseStroke,
    type StrokePoint,
    strokeIdOf,
} from './stroke';

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

    it('消しゴムの color は透明（mode を知らない古い Host で上書き描画されても線が増えない）', () => {
        expect(buildStroke(line, eraser)?.color).toBe(ERASER_FALLBACK_COLOR);
        expect(ERASER_FALLBACK_COLOR).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/);
    });

    it('元の点の配列を共有しない（描画中の配列への追加が確定済みのストロークに漏れない）', () => {
        const points = line.slice();
        const stroke = buildStroke(points, pen);
        points.push([99, 99, 1]);
        expect(stroke?.points).toHaveLength(3);
    });
});

describe('buildStroke の上限', () => {
    it('太さはワールドの data で上限を超えていても丸める（自分のストロークが他人の検証で落ちない）', () => {
        expect(buildStroke(line, { ...pen, strokeWidth: 1000 })?.size).toBe(MAX_STROKE_SIZE);
        expect(buildStroke(line, { ...eraser, strokeWidth: 1000 })?.size).toBe(MAX_STROKE_SIZE);
        expect(buildStroke(line, { ...eraser, strokeWidth: MAX_STROKE_WIDTH })?.size).toBe(MAX_STROKE_SIZE);
    });
});

describe('extendStroke', () => {
    const many = (n: number): StrokePoint[] => Array.from({ length: n }, (_, i) => [i, i, 1]);

    it('上限の手前までは点を足すだけ', () => {
        const { points, full } = extendStroke(many(MAX_STROKE_POINTS - 2), [-1, -1, 1]);
        expect(full).toBeNull();
        expect(points).toHaveLength(MAX_STROKE_POINTS - 1);
    });

    it('上限に達したら 1 本を切り出し、続きは最後の点から始める（線が途切れない）', () => {
        const { points, full } = extendStroke(many(MAX_STROKE_POINTS - 1), [-1, -1, 1]);
        expect(full).toHaveLength(MAX_STROKE_POINTS);
        expect(full?.at(-1)).toEqual([-1, -1, 1]);
        expect(points).toEqual([[-1, -1, 1]]);
    });

    it('どれだけ描いても切り出す 1 本は検証を通る（自分の線が他人に捨てられない）', () => {
        const strokes = Array.from({ length: MAX_STROKE_POINTS * 3 }, (_, i): StrokePoint => [i, -i, 1]).reduce<{
            points: StrokePoint[];
            done: StrokePoint[][];
        }>(
            (acc, p) => {
                const { points, full } = extendStroke(acc.points, p);
                return { points, done: full ? [...acc.done, full] : acc.done };
            },
            { points: [], done: [] },
        );
        expect(strokes.done.length).toBeGreaterThan(1);
        for (const points of strokes.done) expect(parseStroke(buildStroke(points, pen))).not.toBeNull();
    });

    it('元の配列を書き換えない', () => {
        const base = many(3);
        extendStroke(base, [9, 9, 1]);
        expect(base).toHaveLength(3);
    });
});

describe('parseStroke', () => {
    const valid = { points: line, color: '#000000', size: 4 };

    it('自分が組み立てたストロークは線も消しゴムもそのまま通る', () => {
        for (const tool of [pen, eraser]) {
            const stroke = buildStroke(line, tool);
            expect(parseStroke(stroke)).toEqual(stroke);
        }
        expect(parseStroke({ ...valid, mode: 'draw' })).toEqual({ ...valid, mode: 'draw' });
    });

    it('太すぎるストロークは上限に丸める（1 本で全員のキャンバスを消させない）', () => {
        expect(parseStroke({ ...valid, mode: 'erase', size: 1e6 })?.size).toBe(MAX_STROKE_SIZE);
        expect(parseStroke({ ...valid, size: Number.MAX_VALUE })?.size).toBe(MAX_STROKE_SIZE);
    });

    it('data が空・オブジェクトでなければ描かない（空の data の Entity で canvas を落とさない）', () => {
        for (const value of [{}, null, undefined, 'stroke', 42, [line], { points: line }]) {
            expect(parseStroke(value), JSON.stringify(value)).toBeNull();
        }
    });

    it('点が配列でない・1 つ以下・上限より多ければ描かない', () => {
        const tooMany = Array.from({ length: MAX_STROKE_POINTS + 1 }, (_, i): StrokePoint => [i, i, 1]);
        for (const points of [undefined, 'points', { 0: [0, 0, 1], length: 2 }, [], [[0, 0, 1]], tooMany]) {
            expect(parseStroke({ ...valid, points })).toBeNull();
        }
        expect(parseStroke({ ...valid, points: tooMany.slice(1) })).not.toBeNull();
    });

    it('点の形が崩れていれば 1 つでも描かない（NaN・Infinity・文字列・null・要素数違い）', () => {
        for (const bad of [
            [Number.NaN, 0, 1],
            [0, Number.POSITIVE_INFINITY, 1],
            ['1', 0, 1],
            [0, 0, null],
            [0, 0],
            [0, 0, 1, 1],
            null,
            { x: 0, y: 0 },
        ]) {
            expect(parseStroke({ ...valid, points: [[0, 0, 1], bad] }), JSON.stringify(bad)).toBeNull();
        }
    });

    it('色が文字列でない・空・長すぎれば描かない', () => {
        for (const color of [undefined, 0, null, '', 'x'.repeat(65), { r: 0 }]) {
            expect(parseStroke({ ...valid, color })).toBeNull();
        }
    });

    it('太さが正の有限の数でなければ描かない', () => {
        for (const size of [0, -4, Number.NaN, Number.POSITIVE_INFINITY, '4', null, undefined]) {
            expect(parseStroke({ ...valid, size }), String(size)).toBeNull();
        }
    });

    it('知らない mode は描かない（描く・消すのどちらにも倒さない）', () => {
        for (const mode of ['ERASE', 'clear', '', null, 1, true]) {
            expect(parseStroke({ ...valid, mode })).toBeNull();
        }
    });

    it('知らない項目は落とし、点も新しい配列にする（受け取ったデータへの参照を持ち回らない）', () => {
        const points: StrokePoint[] = [
            [0, 0, 1],
            [1, 1, 1],
        ];
        const parsed = parseStroke({ ...valid, points, extra: 'x' });
        expect(parsed).toEqual({ points, color: '#000000', size: 4 });
        expect(parsed?.points).not.toBe(points);
        expect(parsed?.points[0]).not.toBe(points[0]);
    });
});

describe('strokeIdOf', () => {
    it('自分が保存した data から strokeId を読む', () => {
        expect(strokeIdOf({ points: line, color: '#000', size: 4, strokeId: 'abc' })).toBe('abc');
    });

    it('無い・文字列でない・空・長すぎるなら照合しない（線は parseStroke 次第で描く）', () => {
        for (const value of [{}, null, 'abc', { strokeId: 1 }, { strokeId: '' }, { strokeId: 'x'.repeat(65) }]) {
            expect(strokeIdOf(value), JSON.stringify(value)).toBeUndefined();
        }
    });
});
