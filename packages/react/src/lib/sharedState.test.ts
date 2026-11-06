import type { SharedStateResult } from '@ubichill/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSharedState, type SharedStateSocket, updateSharedState } from './sharedState';

function fakeSocket() {
    const calls: Array<{ event: string; data: unknown; reply: (result: SharedStateResult) => void }> = [];
    const socket: SharedStateSocket = {
        emit: (event, data, reply) => {
            calls.push({ event, data, reply: reply as (result: SharedStateResult) => void });
        },
    };
    return { socket, calls };
}

afterEach(() => vi.useRealTimers());

describe('sharedState', () => {
    it('取得と更新を送り、応答に送受信の時刻を添える', async () => {
        const { socket, calls } = fakeSocket();
        const times = [100, 180, 200, 260];
        const now = () => times.shift() ?? 0;
        const got = getSharedState(socket, 'k', now);
        const updated = updateSharedState(socket, { key: 'k', value: { a: 1 }, expectedRevision: 0 }, now);
        expect(calls.map(({ event, data }) => ({ event, data }))).toEqual([
            { event: 'state:get', data: { key: 'k' } },
            { event: 'state:update', data: { key: 'k', value: { a: 1 }, expectedRevision: 0 } },
        ]);
        calls[0].reply({ success: true, entry: null, serverTime: 5 });
        calls[1].reply({ success: false, error: 'conflict', code: 'conflict', entry: null, serverTime: 6 });
        await expect(got).resolves.toEqual({
            result: { success: true, entry: null, serverTime: 5 },
            sentAt: 100,
            receivedAt: 200,
        });
        await expect(updated).resolves.toMatchObject({ result: { code: 'conflict' }, sentAt: 180, receivedAt: 260 });
    });

    it('応答が来なければ null で終わり、遅れて来た応答は捨てる', async () => {
        vi.useFakeTimers();
        const { socket, calls } = fakeSocket();
        const got = getSharedState(socket, 'k', () => 0, 1_000);
        vi.advanceTimersByTime(1_000);
        await expect(got).resolves.toBeNull();
        calls[0].reply({ success: true, entry: null, serverTime: 1 });
        await expect(got).resolves.toBeNull();
    });
});
