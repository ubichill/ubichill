import { describe, expect, it } from 'vitest';
import { generationAction, generationLockUrl, parseDevEvent } from './devSession';

describe('parseDevEvent', () => {
    it('generation・diagnostics を解釈し、形の違うものは捨てる', () => {
        expect(parseDevEvent('generation', '{"buildId":"r-1","instanceId":"dev-r-1"}')).toEqual({
            type: 'generation',
            buildId: 'r-1',
            instanceId: 'dev-r-1',
        });
        expect(
            parseDevEvent(
                'diagnostics',
                '{"failures":[{"kind":"build","mod":"pen","message":"x"},{"kind":"world","message":"y"}]}',
            ),
        ).toEqual({
            type: 'diagnostics',
            failures: [
                { kind: 'build', mod: 'pen', message: 'x' },
                { kind: 'world', message: 'y' },
            ],
        });
        // 空は「直った」。診断を消す
        expect(parseDevEvent('diagnostics', '{"failures":[]}')).toEqual({ type: 'diagnostics', failures: [] });
        // 知らない形の 1 件は捨て、残りは見せる
        expect(
            parseDevEvent(
                'diagnostics',
                '{"failures":[{"kind":"build","message":"no mod"},{"kind":"world","message":"w"},7]}',
            ),
        ).toEqual({ type: 'diagnostics', failures: [{ kind: 'world', message: 'w' }] });
        expect(parseDevEvent('diagnostics', '{"failures":"x"}')).toBeNull();
        expect(parseDevEvent('build-error', '{"mod":"pen","message":"x"}')).toBeNull();
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
