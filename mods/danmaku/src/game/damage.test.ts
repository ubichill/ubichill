import { describe, expect, it } from 'vitest';
import {
    DAMAGE_WRITE_MS,
    type DamageState,
    type DamageStepInput,
    type DamageWrite,
    INITIAL_DAMAGE,
    knownHits,
    MAX_RECORD_HITS,
    parseDamageRecord,
    RECORD_BUDGET_BYTES,
    stageEnemies,
    stepDamage,
} from './damage';
import { activeFrom, enemySpecOf } from './enemy';
import { type FrameInput, stepFrame } from './frame';
import { DOWNWARD, hash01 } from './patterns';
import { type Shot, shotsWhileRiding } from './shots';
import type { Hits } from './stage';

const enemy = (id: string, hp = 999) =>
    enemySpecOf({ id, transform: { x: 0, y: 0, w: 40, h: 40 }, data: { hp, motion: 'none' } });

describe('記録を読む（ほかの人が書いた値も信用しない）', () => {
    it('崩れた記録は無いとみなし、負・NaN の数は捨て、HP の上限より多い数は上限にする', () => {
        expect(parseDamageRecord(null)).toBeNull();
        expect(parseDamageRecord({ round: 1, hits: {} })).toBeNull();
        expect(parseDamageRecord({ round: 1, by: '', hits: {} })).toBeNull();
        expect(parseDamageRecord({ round: -1, by: 'a', hits: {} })).toBeNull();
        expect(parseDamageRecord({ round: 1, by: 'a', hits: [3] })).toBeNull();
        expect(parseDamageRecord({ round: 1, by: 'a', hits: { a: 3, b: -2, c: Number.NaN, d: '4', e: 1e9 } })).toEqual({
            round: 1,
            by: 'a',
            hits: { a: 3, e: MAX_RECORD_HITS },
        });
    });
});

describe('stageEnemies（記録が上限に収まる敵だけを動かす）', () => {
    it.each([0, 9, 100, 650, 1300, 5000])(
        '敵 %i 体（長い ID）でも、記録は上限に収まり、どの画面でも同じ敵を選ぶ',
        (n) => {
            const specs = Array.from({ length: n }, (_, i) => enemy(`${'x'.repeat(40)}-${i}`));
            const chosen = stageEnemies(specs);
            const record = {
                round: 999_999,
                by: 'u'.repeat(64),
                hits: Object.fromEntries(chosen.map((s) => [s.id, MAX_RECORD_HITS])),
            };
            expect(JSON.stringify(record).length).toBeLessThanOrEqual(RECORD_BUDGET_BYTES);
            expect(stageEnemies([...specs].reverse()).map((s) => s.id)).toEqual(chosen.map((s) => s.id));
            if (n <= 100) expect(chosen).toHaveLength(n);
            else expect(chosen.length).toBeLessThan(n);
        },
    );
});

const view = (records: Record<string, unknown>, user = 'me', round = 1) => ({
    user,
    round,
    records: new Map(Object.entries(records)),
});
const step = (
    state: DamageState,
    { records = {}, ...over }: Omit<Partial<DamageStepInput>, 'records'> & { records?: Record<string, unknown> },
) =>
    stepDamage(state, {
        ...view(records, over.user ?? 'me', over.round ?? 1),
        shipId: 'ship-a',
        hits: {},
        enemies: [enemy('e')],
        now: 10_000,
        ...over,
    });

describe('stepDamage・knownHits', () => {
    it('乗っている自機の分は手元の値、ほかの自機は記録（このラウンドの分）を足す', () => {
        const records = {
            'ship-a': { round: 1, by: 'me', hits: { e: 1 } },
            'ship-b': { round: 1, by: 'you', hits: { e: 4 } },
        };
        const { state } = step(INITIAL_DAMAGE, { records, hits: { e: 2 } });
        // ship-a は乗った時点の記録 1（自分が前に書いた分）に、手元の 2 を足す
        expect(knownHits(state, view(records))).toEqual({ e: 7 });
        expect(knownHits(state, view({ ...records, 'ship-c': { round: 0, by: 'old', hits: { e: 50 } } }))).toEqual({
            e: 7,
        });
    });

    it('乗り始めは自機の記録（前に乗っていた人の分）から続け、その人の書き込みが後から届いたら足す', () => {
        const first = step(INITIAL_DAMAGE, {
            records: { 'ship-a': { round: 1, by: 'prev', hits: { e: 3 } } },
            hits: { e: 1 },
        });
        expect(first.writes).toEqual([{ shipId: 'ship-a', record: { round: 1, by: 'me', hits: { e: 4 } } }]);
        const late = { 'ship-a': { round: 1, by: 'prev', hits: { e: 5 } } };
        const second = step(first.state, { records: late, now: 10_000 + DAMAGE_WRITE_MS });
        expect(second.writes).toEqual([{ shipId: 'ship-a', record: { round: 1, by: 'me', hits: { e: 6 } } }]);
        // 自分の書いた値が戻ってきても足さない
        const echo = { 'ship-a': { round: 1, by: 'me', hits: { e: 6 } } };
        expect(knownHits(step(second.state, { records: echo, now: 20_000 }).state, view(echo))).toEqual({ e: 6 });
    });

    it('前のラウンドの記録からは続けない', () => {
        const { writes } = step(INITIAL_DAMAGE, {
            records: { 'ship-a': { round: 0, by: 'me', hits: { e: 9 } } },
            hits: { e: 1 },
        });
        expect(writes[0]?.record.hits).toEqual({ e: 1 });
    });

    it('当たるたびには書かず間隔ごとにまとめ、撃つのをやめても最後の分を書く', () => {
        type Run = { state: DamageState; writes: number };
        const frames = Array.from({ length: 60 }, (_, i) => 10_000 + (i * 1000) / 60);
        const run = frames.reduce<Run>(
            (acc, now) => {
                const next = step(acc.state, { hits: { e: 1 }, now });
                return { state: next.state, writes: acc.writes + next.writes.length };
            },
            { state: INITIAL_DAMAGE, writes: 0 },
        );
        expect(run.writes).toBeGreaterThanOrEqual(Math.floor(1000 / DAMAGE_WRITE_MS));
        expect(run.writes).toBeLessThanOrEqual(Math.ceil(1000 / DAMAGE_WRITE_MS) + 1);
        const flush = step(run.state, { now: run.state.lastWriteAt + DAMAGE_WRITE_MS });
        expect(flush.writes[0]?.record.hits).toEqual({ e: 60 });
        expect(step(flush.state, { now: flush.state.lastWriteAt + 10 * DAMAGE_WRITE_MS }).writes).toEqual([]);
    });

    it('この分で倒れる敵がいれば待たずに書く（ほかの人の記録とあわせて倒れるときも、現れたフレームに倒したときも）', () => {
        const target = enemy('e', 5);
        const written = step(INITIAL_DAMAGE, { enemies: [target], hits: { e: 1 } });
        const soon = written.state.lastWriteAt + 1;
        expect(step(written.state, { enemies: [target], hits: { e: 1 }, now: soon }).writes).toEqual([]);
        const others = { 'ship-b': { round: 1, by: 'you', hits: { e: 3 } } };
        const killed = step(written.state, { enemies: [target], hits: { e: 1 }, now: soon, records: others });
        expect(killed.writes[0]?.record.hits).toEqual({ e: 2 });
        // 書いたのが最初のフレーム（前のフレームでは生きていなかった敵）でも同じ
        const fresh = step({ ...INITIAL_DAMAGE, lastWriteAt: 10_000 }, { enemies: [enemy('e', 1)], hits: { e: 1 } });
        expect(fresh.writes).toHaveLength(1);
    });

    it('降りたら、ためていた分をすぐ前の自機に書き、手元の分は手放す', () => {
        const riding = step(INITIAL_DAMAGE, { hits: { e: 1 } });
        const more = step(riding.state, { hits: { e: 2 }, now: riding.state.lastWriteAt + 1 });
        expect(more.writes).toEqual([]);
        const left = step(more.state, { shipId: null, now: more.state.lastWriteAt + 2 });
        expect(left.writes).toEqual([{ shipId: 'ship-a', record: { round: 1, by: 'me', hits: { e: 3 } } }]);
        expect(left.state.riding).toBeNull();
    });

    it('すぐ乗り直したときも、自分が前に書いた値でなく見えている記録と比べて書く（前の人の画面に断られた値を残さない）', () => {
        // N が {e:2} を書いて降り、P が乗って {e:2}（P）を書き、1 発当てて降りた（P の最後の {e:3} はサーバーに断られた）
        const rode = step(INITIAL_DAMAGE, { hits: { e: 2 } });
        const off = step(rode.state, { shipId: null, now: rode.state.lastWriteAt + 1 });
        expect(off.writes).toEqual([]);
        const byP = { 'ship-a': { round: 1, by: 'p', hits: { e: 2 } } };
        const again = step(off.state, { records: byP, now: rode.state.lastWriteAt + 100 });
        expect(again.writes).toEqual([{ shipId: 'ship-a', record: { round: 1, by: 'me', hits: { e: 2 } } }]);
        // 見えている記録が自分の書く値と同じなら書かず、その後のフレームも書かない
        const mine = { 'ship-a': { round: 1, by: 'me', hits: { e: 2 } } };
        const same = step(off.state, { records: mine, now: rode.state.lastWriteAt + 100 });
        expect(same.writes).toEqual([]);
        expect(step(same.state, { records: mine, now: rode.state.lastWriteAt + 1000 }).writes).toEqual([]);
    });

    it('書く人が分からないときは書かない', () => {
        expect(step(INITIAL_DAMAGE, { user: undefined, hits: { e: 1 } }).writes).toEqual([]);
    });
});

describe('降りたフレーム（自動連射の弾が飛んでいる間に Esc）', () => {
    const target = enemySpecOf({
        id: 'e',
        transform: { x: 380, y: 80, w: 40, h: 40 },
        data: { hp: 3, motion: 'none', pattern: 'radial', count: 1, interval: 100 },
    });
    const t = activeFrom(target) + 0.2;
    const inside: Shot = { x: 400, y: 105, vy: -400, mine: true };
    const frameInput = (hits: Hits, shots: Shot[]): FrameInput => ({
        stageTime: t,
        previousTime: null,
        seconds: 1 / 60,
        area: { x: 0, y: 0, w: 800, h: 600 },
        enemies: [target],
        hits,
        ship: null,
        shots,
        aim: () => DOWNWARD,
        wasAlive: new Set(['e']),
    });

    it('降りたら自分の弾は消え、記録できない当たりで敵が倒れて見えない（2 発当てた分は前の自機に書く）', () => {
        const records: Record<string, unknown> = {};
        const frames = [1, 2].reduce((acc, i) => {
            const known = knownHits(acc, view(records));
            const frame = stepFrame(frameInput(known, shotsWhileRiding([inside], true)));
            expect(frame.myHits).toEqual({ e: 1 });
            return step(acc, { enemies: [target], hits: frame.myHits, now: 10_000 + i, records }).state;
        }, INITIAL_DAMAGE);
        expect(knownHits(frames, view(records))).toEqual({ e: 2 });

        // 降りたフレームでも 1 発が当たる位置にあるが、自分の弾は手放す（手放さないと倒れて見えて、次のフレームで戻る）
        const unfiltered = stepFrame(frameInput({ e: 2 }, [inside]));
        expect(unfiltered.defeated).toHaveLength(1);
        const frame = stepFrame(frameInput({ e: 2 }, shotsWhileRiding([inside], false)));
        expect(frame.myHits).toEqual({});
        expect(frame.defeated).toEqual([]);
        expect(frame.impacts).toEqual([]);
        expect(frame.enemies.map((e) => e.spec.id)).toEqual(['e']);

        const left = step(frames, { shipId: null, enemies: [target], hits: frame.myHits, now: 10_003, records });
        expect(left.writes).toEqual([{ shipId: 'ship-a', record: { round: 1, by: 'me', hits: { e: 2 } } }]);
        const after = { 'ship-a': left.writes[0].record };
        expect(knownHits(left.state, view(after))).toEqual({ e: 2 });
    });

    it('ほかの人の弾は、降りても見た目として飛ばし続ける', () => {
        const theirs: Shot = { ...inside, mine: false };
        expect(shotsWhileRiding([inside, theirs], false)).toEqual([theirs]);
        expect(shotsWhileRiding([inside, theirs], true)).toEqual([inside, theirs]);
    });
});

/**
 * 何人かの画面とサーバーを並べて動かす。サーバーは届いた順に上書きし（最後に書いた人が勝つ）、書いた本人には
 * 返さない。乗っていない人の書き込みは断る（lockedBy）。届くまでの遅れは接続ごとにばらばらだが、順番は保つ。
 */
interface Ride {
    readonly shipId: string;
    readonly from: number;
    readonly to: number;
    /** from を過ぎて、自機が空いたのが見えたらすぐ乗る（前の人の書き込みとサーバーで行き違う）。 */
    readonly whenFree?: boolean;
    /** 乗るだけで撃たない。 */
    readonly quiet?: boolean;
}
interface Message {
    readonly at: number;
    readonly seq: number;
    readonly to: 'server' | number;
    readonly from: number;
    readonly shipId: string;
    readonly change:
        | { readonly kind: 'record'; readonly record: unknown }
        | { readonly kind: 'holder'; readonly holder: string | null };
}
type ShipView = { holder: string | null; record: unknown };

/** 届く時刻（同じなら送った順）で取り出す二分ヒープ。 */
function messageQueue() {
    const heap: Message[] = [];
    const before = (a: Message, b: Message) => a.at < b.at || (a.at === b.at && a.seq < b.seq);
    const swap = (i: number, j: number) => {
        [heap[i], heap[j]] = [heap[j], heap[i]];
    };
    const up = (i: number): void => {
        const parent = (i - 1) >> 1;
        if (i > 0 && before(heap[i], heap[parent])) {
            swap(i, parent);
            up(parent);
        }
    };
    const down = (i: number): void => {
        const smallest = [2 * i + 1, 2 * i + 2]
            .filter((c) => c < heap.length)
            .reduce((best, c) => (before(heap[c], heap[best]) ? c : best), i);
        if (smallest !== i) {
            swap(i, smallest);
            down(smallest);
        }
    };
    const pop = (): Message => {
        const top = heap[0];
        const last = heap.pop() as Message;
        if (heap.length > 0) {
            heap[0] = last;
            down(0);
        }
        return top;
    };
    return {
        push: (message: Message) => {
            heap.push(message);
            up(heap.length - 1);
        },
        /** now までに届くものを順に取り出す（取り出している間に足されたものも含む）。 */
        *takeUntil(now: number): Generator<Message> {
            while (heap.length > 0 && heap[0].at <= now) yield pop();
        },
    };
}

function simulate(
    seed: number,
    rides: readonly (readonly Ride[])[],
    // e0 は HP が低く、倒した当たりをすぐ書く処理も通る
    enemies = [enemy('e0', 6), enemy('e1'), enemy('e2')],
) {
    const users = rides.map((_, i) => `user-${i}`);
    const shipIds = [...new Set(rides.flat().map((r) => r.shipId))];
    const freshShips = () => new Map<string, ShipView>(shipIds.map((id) => [id, { holder: null, record: undefined }]));
    const server = freshShips();
    const views = users.map(freshShips);
    const states: DamageState[] = users.map(() => INITIAL_DAMAGE);
    const truth: Record<string, number> = {};
    const queue = messageQueue();
    const lastArrival = new Map<string, number>();
    const counter = { seq: 0, rejected: 0, urgent: 0 };
    const boarded = new Set<Ride>();
    const send = (from: number, to: 'server' | number, now: number, shipId: string, change: Message['change']) => {
        const link = `${from}->${to}`;
        // たいていは短く、ときどき大きく遅れる
        const delay = 10 + 390 * hash01(seed, counter.seq, 7) ** 3;
        const at = Math.max(lastArrival.get(link) ?? 0, now + delay);
        lastArrival.set(link, at);
        queue.push({ at, seq: counter.seq++, to, from, shipId, change });
    };
    const apply = (ships: Map<string, ShipView>, shipId: string, change: Message['change']) => {
        const ship = ships.get(shipId) as ShipView;
        if (change.kind === 'record') ship.record = change.record;
        else ship.holder = change.holder;
    };
    const deliver = (now: number) => {
        for (const due of queue.takeUntil(now)) {
            if (due.to !== 'server') {
                apply(views[due.to], due.shipId, due.change);
            } else {
                const ship = server.get(due.shipId) as ShipView;
                const writer = users[due.from];
                const allowed =
                    due.change.kind === 'record'
                        ? ship.holder === null || ship.holder === writer
                        : due.change.holder === null
                          ? ship.holder === writer
                          : ship.holder === null || ship.holder === writer;
                if (!allowed && due.change.kind === 'record') counter.rejected++;
                if (allowed) {
                    apply(server, due.shipId, due.change);
                    for (const other of users.keys())
                        if (other !== due.from) send(-1, other, due.at, due.shipId, due.change);
                }
            }
        }
    };

    const FRAME = 1000 / 60;
    for (const frame of Array.from({ length: Math.ceil(8000 / FRAME) }, (_, i) => i)) {
        const now = frame * FRAME;
        deliver(now);
        for (const [i, user] of users.entries()) {
            for (const ride of rides[i]) {
                const free = views[i].get(ride.shipId)?.holder === null;
                if (!boarded.has(ride) && ride.from <= now && ride.to > now && (!ride.whenFree || free)) {
                    boarded.add(ride);
                    apply(views[i], ride.shipId, { kind: 'holder', holder: user });
                    send(i, 'server', now, ride.shipId, { kind: 'holder', holder: user });
                }
                if (ride.to > now - FRAME && ride.to <= now) {
                    apply(views[i], ride.shipId, { kind: 'holder', holder: null });
                    send(i, 'server', now, ride.shipId, { kind: 'holder', holder: null });
                }
            }
            const shipId = [...views[i]].find(([, ship]) => ship.holder === user)?.[0] ?? null;
            const shoots = shipId !== null && !rides[i].some((ride) => ride.quiet && ride.shipId === shipId);
            const target = enemies[Math.floor(hash01(seed, frame, i, 1) * enemies.length)].id;
            const hit = shoots && hash01(seed, frame, i) < 0.4;
            const hits: Hits = hit ? { [target]: 1 } : {};
            if (hit) truth[target] = (truth[target] ?? 0) + 1;
            const records = new Map([...views[i]].map(([id, ship]) => [id, ship.record]));
            const next = stepDamage(states[i], { user, round: 1, records, shipId, hits, enemies, now });
            // 倒した当たりですぐ書いたもの（乗り降りの書き込みは数えない）
            const steady = shipId !== null && states[i].riding?.shipId === shipId;
            if (steady && next.writes.length > 0 && now - states[i].lastWriteAt < DAMAGE_WRITE_MS) counter.urgent++;
            states[i] = next.state;
            for (const write of next.writes as DamageWrite[]) {
                apply(views[i], write.shipId, { kind: 'record', record: write.record });
                send(i, 'server', now, write.shipId, { kind: 'record', record: write.record });
            }
        }
    }
    deliver(Number.POSITIVE_INFINITY);
    const seen = users.map((user, i) =>
        knownHits(states[i], {
            user,
            round: 1,
            records: new Map([...views[i]].map(([id, ship]) => [id, ship.record])),
        }),
    );
    return { truth, seen, rejected: counter.rejected, urgent: counter.urgent };
}

describe('何人かが同時に撃つ（サーバーは最後に書いた人が勝ち、書いた本人には返さない）', () => {
    // 数百通り動かすので、混んだ CI でも既定の 5 秒で切られないようにする
    const SIMULATION_TIMEOUT_MS = 60_000;
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

    it.each([2, 8])(
        '%i 人がそれぞれの自機で 300ms 以内に撃ち始めても、落ち着いたら全員の HP が同じで、当たりが消えも増えもしない',
        (n) => {
            for (const seed of seeds) {
                const rides = Array.from({ length: n }, (_, i) => [
                    { shipId: `ship-${i}`, from: 300 * hash01(seed, i, 99), to: 2500 + 300 * hash01(seed, i, 98) },
                ]);
                const { truth, seen } = simulate(seed, rides);
                for (const hits of seen) expect(hits).toEqual(truth);
            }
        },
        SIMULATION_TIMEOUT_MS,
    );

    it(
        '1 つの自機を乗り継いでも（前の人の書き込みが届ききってから乗れば）、前の人の分は消えず、二重にも数えない',
        () => {
            for (const seed of seeds) {
                const handoff = 1000 + 500 * hash01(seed, 0, 97);
                const rides = [
                    [{ shipId: 'ship-0', from: 0, to: handoff }],
                    [{ shipId: 'ship-0', from: handoff + 1000, to: 3500, whenFree: true }],
                    [{ shipId: 'ship-1', from: 100, to: 3000 }],
                ];
                const { truth, seen } = simulate(seed, rides);
                for (const hits of seen) expect(hits).toEqual(truth);
            }
        },
        SIMULATION_TIMEOUT_MS,
    );

    it(
        '降りてすぐ次の人が乗り（前の人の最後の書き込みがサーバーに断られる）ても、全員の HP がそろい、二重に数えない',
        () => {
            const runs = Array.from({ length: 400 }, (_, i) => i + 1).map((seed) => {
                const handoff = 1000 + 500 * hash01(seed, 0, 97);
                // 次の人が撃たなくても、前の人の画面に断られた値が残らない
                const rides = [
                    [{ shipId: 'ship-0', from: 0, to: handoff }],
                    [{ shipId: 'ship-0', from: handoff, to: 3000, whenFree: true, quiet: seed % 2 === 0 }],
                    [{ shipId: 'ship-1', from: 100, to: 3000 }],
                ];
                return simulate(seed, rides);
            });
            for (const { truth, seen } of runs) {
                for (const hits of seen) expect(hits).toEqual(seen[0]);
                for (const [id, count] of Object.entries(seen[0])) expect(count).toBeLessThanOrEqual(truth[id] ?? 0);
            }
            // 行き違いで断られる書き込みと、倒した当たりですぐ書く場面が、実際に起きている
            expect(runs.reduce((sum, run) => sum + run.rejected, 0)).toBeGreaterThan(0);
            expect(runs.reduce((sum, run) => sum + run.urgent, 0)).toBeGreaterThan(0);
        },
        SIMULATION_TIMEOUT_MS,
    );
});
