import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findAll: vi.fn(),
    delete: vi.fn(),
    presence: vi.fn(),
    close: vi.fn(),
}));
vi.mock('@ubichill/db', () => ({ instanceRepository: { findAll: mocks.findAll, delete: mocks.delete } }));
vi.mock('../config', () => ({
    appConfig: { instance: { emptyTimeoutMs: 60_000, recoveryGraceMs: 60_000, reapIntervalMs: 30_000 } },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/redis', () => ({ redis: null }));
vi.mock('./maintenance', () => ({ maintenanceGate: { hold: async () => true, release: async () => {} } }));
vi.mock('./instanceRuntime', () => ({ instanceRuntime: { presence: mocks.presence, close: mocks.close } }));

import { type AbsenceClock, createMemoryAbsenceClock } from './absenceClock';
import { InstanceReaper } from './instanceReaper';
import { createMemoryLease } from './lease';
import { createLeaseGate, type LeaseGate } from './leaseGate';

const T0 = Date.UTC(2026, 0, 1);
const DAY = 24 * 60 * 60_000;
const old = { id: 'room', createdAt: new Date(T0 - DAY) };
const runtimeRoom = (memberIds: string[], emptySince: number) =>
    new Map([['room', { id: 'room', memberIds, emptySince }]]);
const held: LeaseGate = {
    hold: async () => true,
    run: async (work) => work(async () => true),
    release: async () => {},
};
const newReaper = (deps: { gate?: LeaseGate; absence?: AbsenceClock } = {}) =>
    new InstanceReaper({ gate: deps.gate ?? held, absence: deps.absence ?? createMemoryAbsenceClock(DAY) });

describe('InstanceReaper', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        mocks.findAll.mockResolvedValue([old]);
        mocks.close.mockResolvedValue(true);
        mocks.presence.mockResolvedValue(runtimeRoom(['someone'], 0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('Go の再起動直後で部屋が無くても、古い instance を即削除しない', async () => {
        mocks.presence.mockResolvedValue(new Map());
        expect(await newReaper().sweepOnce()).toBe(0);
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.delete).not.toHaveBeenCalled();
    });
    it('部屋が無い状態が猶予を超えて続いたら削除する', async () => {
        const reaper = newReaper();
        mocks.presence.mockResolvedValue(new Map());
        await reaper.sweepOnce();
        vi.setSystemTime(T0 + 59_999);
        expect(await reaper.sweepOnce()).toBe(0);
        vi.setSystemTime(T0 + 60_000);
        expect(await reaper.sweepOnce()).toBe(1);
        expect(mocks.delete).toHaveBeenCalledWith('room');
    });
    it('猶予中に再接続で部屋が作り直されたら、不在の観測はリセットされる', async () => {
        const reaper = newReaper();
        mocks.presence.mockResolvedValue(new Map());
        await reaper.sweepOnce();
        vi.setSystemTime(T0 + 30_000);
        mocks.presence.mockResolvedValue(runtimeRoom(['alice'], 0));
        await reaper.sweepOnce();
        // 全員が抜けて部屋も消えた（再起動）: 再び観測時刻から数え直す
        vi.setSystemTime(T0 + 70_000);
        mocks.presence.mockResolvedValue(new Map());
        expect(await reaper.sweepOnce()).toBe(0);
        vi.setSystemTime(T0 + 130_000);
        expect(await reaper.sweepOnce()).toBe(1);
    });
    it('在席者がいれば削除しない', async () => {
        vi.setSystemTime(T0 + 10 * 60_000);
        expect(await newReaper().sweepOnce()).toBe(0);
    });
    it('Go 上で空になってから猶予を超えたら削除する', async () => {
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        expect(await newReaper().sweepOnce()).toBe(1);
        expect(mocks.close).toHaveBeenCalledWith('room', T0 - 60_000);
    });
    it('Go が削除を拒否（直前に誰かが入った）したら DB からも消さない', async () => {
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        mocks.close.mockResolvedValue(false);
        expect(await newReaper().sweepOnce()).toBe(0);
        expect(mocks.delete).not.toHaveBeenCalled();
    });
    it('作成直後の instance は Go に部屋が無くても消さない', async () => {
        const reaper = newReaper();
        mocks.findAll.mockResolvedValue([{ ...old, createdAt: new Date(T0) }]);
        mocks.presence.mockResolvedValue(new Map());
        vi.setSystemTime(T0 + 59_999);
        expect(await reaper.sweepOnce()).toBe(0);
    });
    it('Go 上で空の時間が長くても、created_at が新しければ消さず、猶予を過ぎたら消す', async () => {
        // timestamptz は +09 で返っても同じ瞬間を指す（T0 - 30 秒）
        mocks.findAll.mockResolvedValue([{ ...old, createdAt: new Date('2026-01-01 08:59:30+09') }]);
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 10 * 60_000));
        const instanceReaper = newReaper();
        expect(await instanceReaper.sweepOnce()).toBe(0);
        vi.setSystemTime(T0 + 29_999);
        expect(await instanceReaper.sweepOnce()).toBe(0);
        vi.setSystemTime(T0 + 30_000);
        expect(await instanceReaper.sweepOnce()).toBe(1);
        expect(mocks.delete).toHaveBeenCalledWith('room');
    });
    it('created_at が古く Go 上でも猶予を超えて空なら消す', async () => {
        mocks.findAll.mockResolvedValue([{ ...old, createdAt: new Date('2025-12-31 23:58:00+00') }]);
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        expect(await newReaper().sweepOnce()).toBe(1);
        expect(mocks.delete).toHaveBeenCalledWith('room');
    });
    it('Go に到達できなければ何も消さない', async () => {
        mocks.presence.mockRejectedValue(new Error('runtime down'));
        await expect(newReaper().sweepOnce()).rejects.toThrow('runtime down');
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it('リースを持っていなければ DB にも Go にも触らない', async () => {
        const reaper = newReaper({ gate: { hold: async () => false, run: async () => null, release: async () => {} } });
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        expect(await reaper.runOnce()).toBeNull();
        expect(mocks.findAll).not.toHaveBeenCalled();
        expect(mocks.presence).not.toHaveBeenCalled();
        expect(mocks.close).not.toHaveBeenCalled();
    });

    it('リースが別の backend に移っても、不在の起点は引き継がれる（猶予が延びない）', async () => {
        const absence = createMemoryAbsenceClock(DAY);
        const lease = createMemoryLease();
        const log = { info: vi.fn(), warn: vi.fn() };
        const gateA = createLeaseGate(lease, 'reaper', 15_000, log);
        const gateB = createLeaseGate(lease, 'reaper', 15_000, log);
        const a = newReaper({ gate: gateA, absence });
        const b = newReaper({ gate: gateB, absence });
        mocks.presence.mockResolvedValue(new Map());

        expect(await a.runOnce()).toBe(0);
        expect(await b.runOnce()).toBeNull();
        // A が止まって手放した。B が引き継ぎ、A が最初に観測した時刻から数える
        await gateA.release();
        vi.setSystemTime(T0 + 60_000);
        expect(await b.runOnce()).toBe(1);
        expect(mocks.delete).toHaveBeenCalledWith('room');
    });

    it('削除したインスタンスの起点は消す（同じ id がまた不在になったら数え直す）', async () => {
        const absence = createMemoryAbsenceClock(DAY);
        const forget = vi.spyOn(absence, 'forget');
        mocks.presence.mockResolvedValue(new Map());
        const reaper = newReaper({ absence });
        await reaper.sweepOnce();
        vi.setSystemTime(T0 + 60_000);
        await reaper.sweepOnce();
        expect(forget).toHaveBeenLastCalledWith(['room']);
        expect((await absence.since(['room'], T0 + 61_000)).get('room')).toBe(T0 + 61_000);
    });
    it('Go の終了を待っている間にリースを失ったら DB は削除しない', async () => {
        const lease = createMemoryLease();
        const gate = createLeaseGate(lease, 'reaper', 1500, { info: vi.fn(), warn: vi.fn() });
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        let finish!: (closed: boolean) => void;
        mocks.close.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    finish = resolve;
                }),
        );
        const running = newReaper({ gate }).runOnce();
        await vi.advanceTimersByTimeAsync(0);
        const renew = vi.spyOn(lease, 'renew').mockResolvedValue(false);
        await vi.advanceTimersByTimeAsync(1500);
        renew.mockRestore();
        const next = createLeaseGate(lease, 'reaper', 1500, { info: vi.fn(), warn: vi.fn() });
        expect(await next.hold()).toBe(true);
        finish(true);
        expect(await running).toBe(0);
        expect(mocks.delete).not.toHaveBeenCalled();
    });
});
