import { describe, expect, it } from 'vitest';
import { absenceClockFor, createMemoryAbsenceClock } from './absenceClock';
import { absenceClockContract, CONTRACT_ABSENCE_TTL_MS } from './absenceClockContract';

const fakeClock = () => {
    const clock = { now: Date.UTC(2026, 0, 1) };
    return {
        now: () => clock.now,
        advance: async (ms: number) => {
            clock.now += ms;
        },
    };
};

describe('createMemoryAbsenceClock', () => {
    absenceClockContract(() => {
        const clock = fakeClock();
        return { clock: createMemoryAbsenceClock(CONTRACT_ABSENCE_TTL_MS, clock.now), advance: clock.advance };
    });

    it('不正な期限は拒否する', () => {
        for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => createMemoryAbsenceClock(bad)).toThrow(RangeError);
    });
});

describe('absenceClockFor', () => {
    it('Redis を設定していれば、Redis が落ちてもメモリへ切り替えずに失敗を返す', async () => {
        const down = { sendCommand: async () => Promise.reject(new Error('The client is closed')) };
        const clock = absenceClockFor(down, 1000);
        await expect(clock.since(['room'], 1)).rejects.toThrow('closed');
        await expect(clock.forget(['room'])).rejects.toThrow('closed');
    });
});
