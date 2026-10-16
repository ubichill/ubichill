import { describe, expect, it } from 'vitest';
import { createHostRequests, transferablesOf } from './hostRequests';

describe('createHostRequests', () => {
    it('abort した id の signal だけが止まり、登録も外れる', () => {
        const requests = createHostRequests();
        const a = requests.open('a', 60_000);
        const b = requests.open('b', 60_000);

        requests.abort('a');

        expect(a.aborted).toBe(true);
        expect((a.reason as DOMException).name).toBe('AbortError');
        expect(b.aborted).toBe(false);
        expect(requests.size).toBe(1);
    });

    it('abortAll は Worker 破棄としてすべて止める', () => {
        const requests = createHostRequests();
        const signals = ['a', 'b', 'c'].map((id) => requests.open(id, 60_000));
        requests.abortAll();
        expect(signals.every((s) => s.aborted)).toBe(true);
        expect(requests.size).toBe(0);
    });

    it('制限時間を過ぎると TimeoutError で止まる', async () => {
        const requests = createHostRequests();
        const signal = requests.open('slow', 5);
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        expect((signal.reason as DOMException).name).toBe('TimeoutError');
    });

    it('同じ id を開き直したら前の通信は止める（id の使い回しで取り消し漏れを作らない）', () => {
        const requests = createHostRequests();
        const first = requests.open('dup', 60_000);
        const second = requests.open('dup', 60_000);
        expect(first.aborted).toBe(true);
        expect(second.aborted).toBe(false);
        expect(requests.size).toBe(1);
    });

    it('未登録・完了済みの id を abort しても何も起きない', () => {
        const requests = createHostRequests();
        const signal = requests.open('done', 60_000);
        requests.close('done');
        requests.abort('done');
        requests.abort('never');
        expect(signal.aborted).toBe(false);
    });
});

describe('transferablesOf', () => {
    it('ArrayBuffer そのものと、FetchResult の body の ArrayBuffer を移す', () => {
        const buffer = new ArrayBuffer(4);
        expect(transferablesOf(buffer)).toEqual([buffer]);
        expect(transferablesOf({ ok: true, body: buffer })).toEqual([buffer]);
    });

    it('文字列の本文・ビュー・その他は移さない（コピーで送る）', () => {
        expect(transferablesOf({ body: 'text' })).toEqual([]);
        expect(transferablesOf(new Uint8Array(4))).toEqual([]);
        expect(transferablesOf(null)).toEqual([]);
        expect(transferablesOf('x')).toEqual([]);
    });
});
