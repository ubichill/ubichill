import { describe, expect, it } from 'vitest';
import { createRemoteWorldCache } from './remoteWorldCache';

class IntegrityError extends Error {}

const setup = (behavior: (url: string, call: number) => Promise<string>, max = 100) => {
    const clock = { t: 0 };
    const calls = new Map<string, number>();
    const cache = createRemoteWorldCache<string>({
        load: (url) => {
            const n = (calls.get(url) ?? 0) + 1;
            calls.set(url, n);
            return behavior(url, n);
        },
        isIntegrityError: (err): err is Error => err instanceof IntegrityError,
        ttlMs: 1000,
        failureTtlMs: 100,
        max,
        now: () => clock.t,
    });
    return { cache, clock, calls };
};

describe('createRemoteWorldCache', () => {
    it('成功は期限内は取得し直さず、期限を過ぎたら取り直す', async () => {
        const { cache, clock, calls } = setup(async (url, n) => `${url}#${n}`);
        expect(await cache.resolve('u')).toEqual({ ok: true, world: 'u#1' });
        expect(await cache.resolve('u')).toEqual({ ok: true, world: 'u#1' });
        clock.t = 1000;
        expect(await cache.resolve('u')).toEqual({ ok: true, world: 'u#2' });
        expect(calls.get('u')).toBe(2);
    });

    it('結果ごとの期限（ttlFor）を使う（作者をいま確かめられなかった結果はすぐ取り直す）', async () => {
        const clock = { t: 0 };
        const calls = { n: 0 };
        const cache = createRemoteWorldCache<{ pending: boolean }>({
            load: async () => ({ pending: ++calls.n === 1 }),
            isIntegrityError: (err): err is Error => err instanceof IntegrityError,
            ttlMs: 1000,
            ttlFor: (w) => (w.pending ? 10 : 1000),
            failureTtlMs: 100,
            max: 10,
            now: () => clock.t,
        });
        expect(await cache.resolve('u')).toEqual({ ok: true, world: { pending: true } });
        clock.t = 10;
        expect(await cache.resolve('u')).toEqual({ ok: true, world: { pending: false } });
        clock.t = 500;
        await cache.resolve('u');
        expect(calls.n).toBe(2);
    });

    it('取得できない URL を繰り返し読ませても、失敗の期限内は外部へ取得しない', async () => {
        const { cache, clock, calls } = setup(async () => {
            throw new Error('down');
        });
        for (let i = 0; i < 50; i++) expect((await cache.resolve('dead')).ok).toBe(false);
        expect(calls.get('dead')).toBe(1);
        clock.t = 100;
        await cache.resolve('dead');
        expect(calls.get('dead')).toBe(2);
    });

    it('失敗が復旧したら次の取得で成功に戻る', async () => {
        const { cache, clock } = setup(async (_url, n) => {
            if (n === 1) throw new Error('down');
            return 'ok';
        });
        expect((await cache.resolve('u')).ok).toBe(false);
        clock.t = 100;
        expect(await cache.resolve('u')).toEqual({ ok: true, world: 'ok' });
    });

    it('同時の解決は 1 回の取得にまとめる', async () => {
        const { cache, calls } = setup(async () => {
            await new Promise((r) => setTimeout(r, 5));
            return 'w';
        });
        await Promise.all([cache.resolve('u'), cache.resolve('u'), cache.resolve('u')]);
        expect(calls.get('u')).toBe(1);
    });

    it('取得に失敗しても、以前の成功結果があればそれを返す', async () => {
        const { cache, clock } = setup(async (_url, n) => {
            if (n === 1) return 'old';
            throw new Error('down');
        });
        await cache.resolve('u');
        clock.t = 1000;
        expect(await cache.resolve('u')).toEqual({ ok: true, world: 'old' });
    });

    it('改竄を検知したら、以前の成功結果があっても使い続けず、理由を返す', async () => {
        const { cache, clock } = setup(async (_url, n) => {
            if (n === 1) return 'good';
            throw new IntegrityError('署名が一致しません');
        });
        await cache.resolve('u');
        clock.t = 1000;
        expect(await cache.resolve('u')).toEqual({ ok: false, reason: 'integrity', message: '署名が一致しません' });
        clock.t = 1100;
        expect((await cache.resolve('u')).ok).toBe(false);
    });

    it('URL を変え続けられても、記録は上限までしか持たない', async () => {
        const { cache, calls } = setup(async () => {
            throw new Error('down');
        }, 3);
        for (const u of ['a', 'b', 'c', 'd']) await cache.resolve(u);
        await cache.resolve('a'); // a の失敗記録は捨てられているので取り直す
        expect(calls.get('a')).toBe(2);
        await cache.resolve('d'); // d は残っている
        expect(calls.get('d')).toBe(1);
    });

    it('clearWorlds は成功結果だけを捨てる（失敗の記録は外部取得の抑制なので残す）', async () => {
        const { cache, calls } = setup(async (url) => {
            if (url === 'dead') throw new Error('down');
            return 'w';
        });
        await cache.resolve('ok');
        await cache.resolve('dead');
        cache.clearWorlds();
        await cache.resolve('ok');
        await cache.resolve('dead');
        expect(calls.get('ok')).toBe(2);
        expect(calls.get('dead')).toBe(1);
    });
});
