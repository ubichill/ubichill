import { describe, expect, it } from 'vitest';
import { acceptReplacedStrokes, MAX_REPLACED_STROKES } from './useModCanvas';

describe('acceptReplacedStrokes', () => {
    it('配列でないもの（mod は信用しない）は空にする', () => {
        for (const bad of [null, undefined, 1, 'x', { length: 3 }]) expect(acceptReplacedStrokes(bad)).toEqual([]);
    });

    it('上限を超えたら新しい方を残し、渡された配列そのものは使わない（あとで書き換えられても影響しない）', () => {
        const many = Array.from({ length: MAX_REPLACED_STROKES + 5 }, (_, i) => ({ i }));
        const accepted = acceptReplacedStrokes(many);
        expect(accepted).toHaveLength(MAX_REPLACED_STROKES);
        expect(accepted[0]).toEqual({ i: 5 });
        expect(accepted).not.toBe(many);
    });
});
