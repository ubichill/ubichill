import { describe, expect, it } from 'vitest';
import { type DevEvent, generationAction, generationLockUrl, parseDevEvent, recordFailure } from './devSession';

describe('parseDevEvent', () => {
    it('generation・build-error・world-error を解釈し、形の違うものは捨てる', () => {
        expect(parseDevEvent('generation', '{"buildId":"r-1","instanceId":"dev-r-1"}')).toEqual({
            type: 'generation',
            buildId: 'r-1',
            instanceId: 'dev-r-1',
        });
        expect(parseDevEvent('build-error', '{"mod":"pen","message":"x"}')).toEqual({
            type: 'build-error',
            mod: 'pen',
            message: 'x',
        });
        expect(parseDevEvent('world-error', '{"message":"y"}')).toEqual({ type: 'world-error', message: 'y' });
        expect(parseDevEvent('generation', '{"buildId":1}')).toBeNull();
        expect(parseDevEvent('unknown', '{}')).toBeNull();
        expect(parseDevEvent('generation', 'not json')).toBeNull();
    });
});

describe('generationAction', () => {
    it('最初の世代は使い始め、同じ世代は何もせず、違う世代なら読み直す', () => {
        const g1 = { buildId: 'r-1', instanceId: 'dev-r-1' };
        expect(generationAction(null, g1)).toBe('adopt');
        expect(generationAction(g1, { ...g1 })).toBe('keep');
        expect(generationAction(g1, { buildId: 'r-2', instanceId: 'dev-r-1' })).toBe('reload');
    });
    it('lock の URL は世代ごと', () => {
        expect(generationLockUrl('r-1')).toBe('/__ubichill/g/r-1/lock.json');
    });
});

describe('recordFailure', () => {
    const err = (mod: string, message = 'e'): DevEvent => ({ type: 'build-error', mod, message });
    it('同じ mod の失敗は新しいもので置き換え、ワールドの失敗は 1 件だけ', () => {
        const a = recordFailure([], err('pen', 'first'));
        const b = recordFailure(a, err('danmaku'));
        const c = recordFailure(b, err('pen', 'second'));
        expect(c).toEqual([err('danmaku'), err('pen', 'second')]);
        const d = recordFailure(c, { type: 'world-error', message: 'w1' });
        const e = recordFailure(d, { type: 'world-error', message: 'w2' });
        expect(e.filter((f) => f.type === 'world-error')).toEqual([{ type: 'world-error', message: 'w2' }]);
    });
    it('世代の通知は失敗を消さない（直った mod は次のビルドで無くなるのではなく、成功した世代が届く）', () => {
        expect(recordFailure([err('pen')], { type: 'generation', buildId: 'r', instanceId: 'i' })).toEqual([
            err('pen'),
        ]);
    });
    it('上限を超えたら古いものから捨てる', () => {
        const many = Array.from({ length: 25 }, (_, i) => err(`m${i}`)).reduce(
            (acc, e) => recordFailure(acc, e),
            [] as DevEvent[],
        );
        expect(many).toHaveLength(20);
        expect(many[0]).toEqual(err('m5'));
    });
});
