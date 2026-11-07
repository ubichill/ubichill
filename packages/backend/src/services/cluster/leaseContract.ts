import { expect, it } from 'vitest';
import type { Lease } from './lease';

/** 契約テストを当てる実装と、期限を進める方法の組（メモリは時計を進め、Redis は実際に待つ）。 */
export interface LeaseUnderTest {
    lease: Lease;
    advance: (ms: number) => Promise<void>;
}

export const CONTRACT_TTL_MS = 200;

/**
 * メモリ実装と Redis 実装に同じ振る舞いを求めるテスト群。describe の中で呼ぶ。
 * create はテストごとに独立した名前空間のリースを返すこと。
 */
export function leaseContract(create: () => LeaseUnderTest): void {
    const ttl = CONTRACT_TTL_MS;
    const isHeld = async (lease: Lease, name: string): Promise<boolean> => {
        const probe = await lease.acquire(name, ttl);
        if (probe) await lease.release(name, probe);
        return probe === null;
    };

    it('同時に持てるのは 1 人だけ。名前が違えば独立する', async () => {
        const { lease } = create();
        expect(await lease.acquire('a', ttl)).toEqual(expect.any(String));
        expect(await lease.acquire('a', ttl)).toBeNull();
        expect(await lease.acquire('b', ttl)).toEqual(expect.any(String));
    });

    it('同時に取りに行っても token は 1 つしか出ない', async () => {
        const { lease } = create();
        const results = await Promise.all(Array.from({ length: 20 }, () => lease.acquire('race', ttl)));
        expect(results.filter((token) => token !== null)).toHaveLength(1);
    });

    it('今の token でだけ延長できる', async () => {
        const { lease, advance } = create();
        const token = await lease.acquire('a', ttl);
        expect(await lease.renew('a', 'not-the-token', ttl * 10)).toBe(false);
        expect(await lease.renew('a', token ?? '', ttl * 3)).toBe(true);
        await advance(ttl * 2);
        expect(await isHeld(lease, 'a')).toBe(true);
    });

    it('違う token では延長も解放もできない', async () => {
        const { lease, advance } = create();
        await lease.acquire('a', ttl);
        expect(await lease.release('a', 'not-the-token')).toBe(false);
        expect(await isHeld(lease, 'a')).toBe(true);
        await lease.renew('a', 'not-the-token', ttl * 10);
        await advance(ttl + 50);
        expect(await isHeld(lease, 'a')).toBe(false);
    });

    it('解放したら空き、古い token は次の持ち主に効かない', async () => {
        const { lease } = create();
        const old = (await lease.acquire('a', ttl)) ?? '';
        expect(await lease.release('a', old)).toBe(true);
        expect(await lease.release('a', old)).toBe(false);
        const next = await lease.acquire('a', ttl);
        expect(next).not.toBeNull();
        expect(next).not.toBe(old);
        expect(await lease.renew('a', old, ttl)).toBe(false);
        expect(await lease.release('a', old)).toBe(false);
        expect(await isHeld(lease, 'a')).toBe(true);
    });

    it('期限が切れた持ち主は、延長も次の持ち主の解放もできない', async () => {
        const { lease, advance } = create();
        const old = (await lease.acquire('a', ttl)) ?? '';
        await advance(ttl + 50);
        expect(await lease.renew('a', old, ttl)).toBe(false);
        expect(await lease.acquire('a', ttl)).not.toBeNull();
        expect(await lease.release('a', old)).toBe(false);
        expect(await isHeld(lease, 'a')).toBe(true);
    });

    it('持ち主のいない名前は延長できない（空の token も通らない）', async () => {
        const { lease } = create();
        expect(await lease.renew('never', 'token', ttl)).toBe(false);
        expect(await lease.renew('never', '', ttl)).toBe(false);
        expect(await lease.release('never', '')).toBe(false);
    });

    it('不正な名前・期限は拒否する', async () => {
        const { lease } = create();
        for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(lease.acquire('a', bad)).rejects.toThrow(RangeError);
            await expect(lease.renew('a', 't', bad)).rejects.toThrow(RangeError);
        }
        await expect(lease.acquire('', ttl)).rejects.toThrow(RangeError);
        await expect(lease.release('', 't')).rejects.toThrow(RangeError);
    });
}
