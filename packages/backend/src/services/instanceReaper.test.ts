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
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./instanceRuntime', () => ({ instanceRuntime: { presence: mocks.presence, close: mocks.close } }));

import { instanceReaper } from './instanceReaper';

const T0 = Date.UTC(2026, 0, 1);
const old = { id: 'room', createdAt: new Date(T0 - 24 * 60 * 60_000) };
const runtimeRoom = (memberIds: string[], emptySince: number) =>
    new Map([['room', { id: 'room', memberIds, emptySince }]]);

describe('instanceReaper', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        mocks.findAll.mockResolvedValue([old]);
        mocks.close.mockResolvedValue(true);
        // 前のテストの観測記録を残さない（シングルトン）
        mocks.presence.mockResolvedValue(runtimeRoom(['someone'], 0));
        return instanceReaper.sweepOnce();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('Go の再起動直後で部屋が無くても、古い instance を即削除しない', async () => {
        mocks.presence.mockResolvedValue(new Map());
        expect(await instanceReaper.sweepOnce()).toBe(0);
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.delete).not.toHaveBeenCalled();
    });
    it('部屋が無い状態が猶予を超えて続いたら削除する', async () => {
        mocks.presence.mockResolvedValue(new Map());
        await instanceReaper.sweepOnce();
        vi.setSystemTime(T0 + 59_999);
        expect(await instanceReaper.sweepOnce()).toBe(0);
        vi.setSystemTime(T0 + 60_000);
        expect(await instanceReaper.sweepOnce()).toBe(1);
        expect(mocks.delete).toHaveBeenCalledWith('room');
    });
    it('猶予中に再接続で部屋が作り直されたら、不在の観測はリセットされる', async () => {
        mocks.presence.mockResolvedValue(new Map());
        await instanceReaper.sweepOnce();
        vi.setSystemTime(T0 + 30_000);
        mocks.presence.mockResolvedValue(runtimeRoom(['alice'], 0));
        await instanceReaper.sweepOnce();
        // 全員が抜けて部屋も消えた（再起動）: 再び観測時刻から数え直す
        vi.setSystemTime(T0 + 70_000);
        mocks.presence.mockResolvedValue(new Map());
        expect(await instanceReaper.sweepOnce()).toBe(0);
        vi.setSystemTime(T0 + 130_000);
        expect(await instanceReaper.sweepOnce()).toBe(1);
    });
    it('在席者がいれば削除しない', async () => {
        vi.setSystemTime(T0 + 10 * 60_000);
        expect(await instanceReaper.sweepOnce()).toBe(0);
    });
    it('Go 上で空になってから猶予を超えたら削除する', async () => {
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        expect(await instanceReaper.sweepOnce()).toBe(1);
        expect(mocks.close).toHaveBeenCalledWith('room', T0 - 60_000);
    });
    it('Go が削除を拒否（直前に誰かが入った）したら DB からも消さない', async () => {
        mocks.presence.mockResolvedValue(runtimeRoom([], T0 - 60_000));
        mocks.close.mockResolvedValue(false);
        expect(await instanceReaper.sweepOnce()).toBe(0);
        expect(mocks.delete).not.toHaveBeenCalled();
    });
    it('作成直後の instance は Go に部屋が無くても消さない', async () => {
        instanceReaper.markCreated('room');
        mocks.findAll.mockResolvedValue([{ ...old, createdAt: new Date(T0) }]);
        mocks.presence.mockResolvedValue(new Map());
        vi.setSystemTime(T0 + 59_999);
        expect(await instanceReaper.sweepOnce()).toBe(0);
    });
    it('Go に到達できなければ何も消さない', async () => {
        mocks.presence.mockRejectedValue(new Error('runtime down'));
        await expect(instanceReaper.sweepOnce()).rejects.toThrow('runtime down');
        expect(mocks.delete).not.toHaveBeenCalled();
    });
});
