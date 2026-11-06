import { expect, it } from 'vitest';
import type { AbsenceClock } from './absenceClock';

/** 契約テストを当てる実装と、期限を進める方法（メモリは時計を進め、Redis は実際に待つ）。ttlMs は CONTRACT_ABSENCE_TTL_MS。 */
export interface AbsenceClockUnderTest {
    clock: AbsenceClock;
    advance: (ms: number) => Promise<void>;
}

export const CONTRACT_ABSENCE_TTL_MS = 200;

/** メモリ実装と Redis 実装に同じ振る舞いを求めるテスト群。describe の中で呼ぶ。create はテストごとに独立した名前空間を返すこと。 */
export function absenceClockContract(create: () => AbsenceClockUnderTest): void {
    const T = 1_700_000_000_000;

    it('最初に観測した時刻を覚え、2 回目からはその時刻を返す', async () => {
        const { clock } = create();
        expect(await clock.since(['a'], T)).toEqual(new Map([['a', T]]));
        expect(await clock.since(['a'], T + 5000)).toEqual(new Map([['a', T]]));
    });

    it('id ごとに独立し、初めての id だけ新しい時刻になる', async () => {
        const { clock } = create();
        await clock.since(['a'], T);
        expect(await clock.since(['a', 'b'], T + 10)).toEqual(
            new Map([
                ['a', T],
                ['b', T + 10],
            ]),
        );
    });

    it('同時に観測しても起点は 1 つに決まる', async () => {
        const { clock } = create();
        const results = await Promise.all(Array.from({ length: 10 }, (_, i) => clock.since(['a'], T + i)));
        const starts = new Set(results.map((r) => r.get('a')));
        expect(starts.size).toBe(1);
    });

    it('消したら次の観測から数え直す。ほかの id は残る', async () => {
        const { clock } = create();
        await clock.since(['a', 'b'], T);
        await clock.forget(['a']);
        expect(await clock.since(['a', 'b'], T + 100)).toEqual(
            new Map([
                ['a', T + 100],
                ['b', T],
            ]),
        );
    });

    it('期限を過ぎた記録は数え直す（消し過ぎない側）', async () => {
        const { clock, advance } = create();
        await clock.since(['a'], T);
        await advance(CONTRACT_ABSENCE_TTL_MS + 50);
        expect((await clock.since(['a'], T + 1)).get('a')).toBe(T + 1);
    });

    it('空の id の一覧では何もしない', async () => {
        const { clock } = create();
        expect(await clock.since([], T)).toEqual(new Map());
        await expect(clock.forget([])).resolves.toBeUndefined();
        await expect(clock.forget(['never'])).resolves.toBeUndefined();
    });
}
