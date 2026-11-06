import { describe, expect, it } from 'vitest';
import { activeCount, fnv1a, loadtestAccount, planUser, roomsPerRunner, roomTag, runnerSlot } from './plan.ts';

describe('runnerSlot', () => {
    it('segment が無ければ runner は 1 つ', () => {
        expect(runnerSlot(undefined, undefined)).toEqual({ index: 0, count: 1 });
        expect(runnerSlot('', '')).toEqual({ index: 0, count: 1 });
    });

    it('k6-operator の渡し方（i/n:(i+1)/n と 0,1/n,...,1）から何番目かを読む', () => {
        expect(runnerSlot('0:1/3', '0,1/3,2/3,1')).toEqual({ index: 0, count: 3 });
        expect(runnerSlot('1/3:2/3', '0,1/3,2/3,1')).toEqual({ index: 1, count: 3 });
        expect(runnerSlot('2/3:1', '0,1/3,2/3,1')).toEqual({ index: 2, count: 3 });
    });

    it('約分された表記（2/4 と 1/2）でも同じ位置とみなす', () => {
        expect(runnerSlot('2/4:3/4', '0,1/4,1/2,3/4,1')).toEqual({ index: 2, count: 4 });
    });

    it('sequence が無ければ segment の幅から数を出す', () => {
        expect(runnerSlot('1/2:1', undefined)).toEqual({ index: 1, count: 2 });
        expect(runnerSlot('1/2', undefined)).toEqual({ index: 0, count: 2 });
    });

    it('sequence に無い segment・読めない値は投げる（黙って部屋を重ねない）', () => {
        expect(() => runnerSlot('1/5:2/5', '0,1/2,1')).toThrow();
        expect(() => runnerSlot('x:1', '0,1')).toThrow();
        expect(() => runnerSlot('1:1', '0,1/2,1')).toThrow();
    });
});

describe('roomsPerRunner', () => {
    it('割り切れなければ null', () => {
        expect(roomsPerRunner(100, { index: 0, count: 2 })).toBe(50);
        expect(roomsPerRunner(5, { index: 0, count: 2 })).toBeNull();
    });
});

describe('activeCount', () => {
    it('3 割（四捨五入）。割合が正なら遅延の送り手の 1 人は必ず含める', () => {
        expect(activeCount(10, 0.3)).toBe(3);
        expect(activeCount(2, 0.1)).toBe(1);
        expect(activeCount(50, 0.3)).toBe(15);
    });

    it('割合 0 なら誰も送らない、1 なら全員', () => {
        expect(activeCount(10, 0)).toBe(0);
        expect(activeCount(10, 1)).toBe(10);
    });
});

describe('planUser', () => {
    const input = { rooms: 4, usersPerRoom: 3, activeRatio: 0.34 };

    it('runner の中の番号の順に部屋を埋め、1 人目が作り手・2 人目が遅延の受け手', () => {
        const slot = { index: 0, count: 1 };
        const plans = Array.from({ length: 4 }, (_, i) => planUser(input, slot, i));
        expect(plans.map((p) => [p?.room, p?.indexInRoom])).toEqual([
            [0, 0],
            [0, 1],
            [0, 2],
            [1, 0],
        ]);
        expect(plans[0]).toMatchObject({ creator: true, latencyReceiver: false, active: true, stateWriter: true });
        expect(plans[1]).toMatchObject({ creator: false, latencyReceiver: true, active: false, stateWriter: true });
        expect(plans[2]).toMatchObject({ creator: false, latencyReceiver: false, stateWriter: false });
    });

    it('runner ごとに別の部屋の範囲を持ち、利用者の番号は試験全体で重ならない', () => {
        const slots = [0, 1].map((index) => ({ index, count: 2 }));
        const all = slots.flatMap((slot) => Array.from({ length: 6 }, (_, i) => planUser(input, slot, i)));
        const indexes = all.map((p) => p?.userIndex);
        expect(new Set(indexes).size).toBe(12);
        expect([...indexes].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 12 }, (_, i) => i));
        expect(all.slice(0, 6).every((p) => (p?.room ?? -1) < 2)).toBe(true);
        expect(all.slice(6).every((p) => (p?.room ?? -1) >= 2)).toBe(true);
    });

    it('範囲の外の iteration（arrival-rate の端数）・負の番号は null', () => {
        expect(planUser(input, { index: 0, count: 1 }, 12)).toBeNull();
        expect(planUser(input, { index: 0, count: 1 }, -1)).toBeNull();
    });

    it('部屋が runner で割り切れなければ誰も割り当てない', () => {
        expect(planUser({ ...input, rooms: 3 }, { index: 0, count: 2 }, 0)).toBeNull();
    });

    it('1 部屋 1 人なら受け手はいない（遅延は測れない）', () => {
        const plan = planUser({ rooms: 1, usersPerRoom: 1, activeRatio: 1 }, { index: 0, count: 1 }, 0);
        expect(plan).toMatchObject({ creator: true, latencyReceiver: false });
    });
});

describe('roomTag', () => {
    it('access.tags の上限（20 文字）に収まる', () => {
        expect(roomTag('rooms10x100-1104-1530-very-long-name-for-test', 99_999).length).toBeLessThanOrEqual(20);
    });

    it('走りが違えば同じ部屋番号でも別の印（消し忘れの部屋に入らない）', () => {
        expect(roomTag('run-a', 0)).not.toBe(roomTag('run-b', 0));
        expect(roomTag('run-a', 1)).not.toBe(roomTag('run-a', 11));
    });

    it('同じ走り・同じ部屋なら runner をまたいでも同じ印', () => {
        expect(roomTag('run-a', 3)).toBe(roomTag('run-a', 3));
    });

    it('FNV-1a の既知の値', () => {
        expect(fnv1a('')).toBe(0x811c9dc5);
        expect(fnv1a('a')).toBe(0xe40c292c);
    });
});

describe('loadtestAccount', () => {
    it('ID は英小文字・数字・_ の 30 文字以内（大きな番号でも）', () => {
        const account = loadtestAccount('user', 1_000_000_000, 'password-1');
        expect(account.handle).toMatch(/^[a-z0-9_]{3,30}$/);
        expect(loadtestAccount('web', 1_000_000_000, 'password-1').handle).toMatch(/^[a-z0-9_]{3,30}$/);
    });

    it('利用者と画面の確認のアカウントは重ならない', () => {
        expect(loadtestAccount('user', 1, 'p').handle).not.toBe(loadtestAccount('web', 1, 'p').handle);
        expect(loadtestAccount('user', 1, 'p').email).not.toBe(loadtestAccount('web', 1, 'p').email);
    });

    it('表示名は 30 文字以内（Go の名前の上限）', () => {
        expect(loadtestAccount('web', 1_000_000_000, 'p').displayName.length).toBeLessThanOrEqual(30);
    });

    it('負・小数の番号は投げる', () => {
        expect(() => loadtestAccount('user', -1, 'p')).toThrow();
        expect(() => loadtestAccount('user', 1.5, 'p')).toThrow();
    });
});
