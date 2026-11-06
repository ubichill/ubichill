import { describe, expect, it } from 'vitest';
import { type DevEvent, formatDevEvent, parseDevEvent } from './devEvents';

/** ブラウザの EventSource と同じ読み方: `event:` を名前、`data:` を中身にする。 */
const readSse = (text: string) => {
    const lines = text.trimEnd().split('\n');
    const field = (key: string) =>
        lines
            .filter((l) => l.startsWith(`${key}: `))
            .map((l) => l.slice(key.length + 2))
            .join('\n');
    return parseDevEvent(field('event'), field('data'));
};

describe('dev の SSE の約束', () => {
    it('サーバーが書いた形を、ブラウザがそのまま読める（両側が同じ定義を使う）', () => {
        const events: DevEvent[] = [
            { type: 'generation', buildId: 'r-1', instanceId: 'dev-r-1' },
            {
                type: 'diagnostics',
                failures: [
                    { kind: 'build', mod: 'pen', message: 'line 1\nline 2' },
                    { kind: 'world', message: 'kind が違う' },
                ],
            },
            { type: 'diagnostics', failures: [] },
        ];
        for (const event of events) expect(readSse(formatDevEvent(event))).toEqual(event);
    });

    it('知らない形は捨てる。診断の中の知らない 1 件だけを捨て、残りは見せる', () => {
        expect(
            parseDevEvent(
                'diagnostics',
                '{"failures":[{"kind":"build","message":"no mod"},{"kind":"world","message":"w"},7,null]}',
            ),
        ).toEqual({ type: 'diagnostics', failures: [{ kind: 'world', message: 'w' }] });
        expect(parseDevEvent('diagnostics', '{"failures":"x"}')).toBeNull();
        expect(parseDevEvent('build-error', '{"mod":"pen","message":"x"}')).toBeNull();
        expect(parseDevEvent('generation', '{"buildId":1}')).toBeNull();
        expect(parseDevEvent('generation', 'not json')).toBeNull();
        expect(parseDevEvent('generation', 'null')).toBeNull();
    });
});
