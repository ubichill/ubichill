import { describe, expect, it, vi } from 'vitest';
import { fetchRetryingServerErrors } from './release.ts';

const answer = (status: number) => new Response(null, { status });

describe('fetchRetryingServerErrors', () => {
    it('5xx と通信の失敗はやり直し、待つ時間を倍にしていく', async () => {
        const replies = [
            Promise.reject(new Error('reset')),
            Promise.resolve(answer(503)),
            Promise.resolve(answer(200)),
        ];
        const request = vi.fn(() => replies.shift() ?? Promise.resolve(answer(200)));
        const sleep = vi.fn(async () => {});
        const response = await fetchRetryingServerErrors(request, { delayMs: 10, sleep });
        expect(response.status).toBe(200);
        expect(request).toHaveBeenCalledTimes(3);
        expect(sleep.mock.calls).toEqual([[10], [20]]);
    });

    it('404 などはやり直さずに返す', async () => {
        const request = vi.fn(async () => answer(404));
        const response = await fetchRetryingServerErrors(request, { sleep: async () => {} });
        expect(response.status).toBe(404);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('回数を使い切ったら最後の答え（または失敗）を返す', async () => {
        const sleep = async () => {};
        expect((await fetchRetryingServerErrors(async () => answer(503), { attempts: 2, sleep })).status).toBe(503);
        await expect(
            fetchRetryingServerErrors(() => Promise.reject(new Error('offline')), { attempts: 2, sleep }),
        ).rejects.toThrow('offline');
    });
});
