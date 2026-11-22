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
import { enemySpecOf } from './enemy';
import { hash01 } from './patterns';
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

    it('書く人が分からないときは書かない', () => {
        expect(step(INITIAL_DAMAGE, { user: undefined, hits: { e: 1 } }).writes).toEqual([]);
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

function simulate(
    seed: number,
    rides: readonly (readonly Ride[])[],
    enemies = [enemy('e0'), enemy('e1'), enemy('e2')],
) {
    const users = rides.map((_, i) => `user-${i}`);
    const shipIds = [...new Set(rides.flat().map((r) => r.shipId))];
    const freshShips = () => new Map<string, ShipView>(shipIds.map((id) => [id, { holder: null, record: undefined }]));
    const server = freshShips();
    const views = users.map(freshShips);
    const states: DamageState[] = users.map(() => INITIAL_DAMAGE);
    const truth: Record<string, number> = {};
    const queue: Message[] = [];
    const lastArrival = new Map<string, number>();
    const counter = { seq: 0 };
    const send = (from: number, to: 'server' | number, now: number, shipId: string, change: Message['change']) => {
        const link = `${from}->${to}`;
        const delay = 10 + 190 * hash01(seed, counter.seq, 7);
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
        const due = queue.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) return;
        queue.splice(queue.indexOf(due), 1);
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
            if (allowed) {
                apply(server, due.shipId, due.change);
                for (const other of users.keys())
                    if (other !== due.from) send(-1, other, due.at, due.shipId, due.change);
            }
        }
        deliver(now);
    };

    const FRAME = 1000 / 60;
    for (const frame of Array.from({ length: Math.ceil(8000 / FRAME) }, (_, i) => i)) {
        const now = frame * FRAME;
        deliver(now);
        for (const [i, user] of users.entries()) {
            for (const ride of rides[i]) {
                if (ride.from > now - FRAME && ride.from <= now) {
                    apply(views[i], ride.shipId, { kind: 'holder', holder: user });
                    send(i, 'server', now, ride.shipId, { kind: 'holder', holder: user });
                }
                if (ride.to > now - FRAME && ride.to <= now) {
                    apply(views[i], ride.shipId, { kind: 'holder', holder: null });
                    send(i, 'server', now, ride.shipId, { kind: 'holder', holder: null });
                }
            }
            const shipId = [...views[i]].find(([, ship]) => ship.holder === user)?.[0] ?? null;
            const roll = hash01(seed, frame, i);
            const target = enemies[Math.floor(hash01(seed, frame, i, 1) * enemies.length)].id;
            const hits: Hits = shipId && roll < 0.4 ? { [target]: 1 } : {};
            if (shipId && roll < 0.4) truth[target] = (truth[target] ?? 0) + 1;
            const records = new Map([...views[i]].map(([id, ship]) => [id, ship.record]));
            const next = stepDamage(states[i], { user, round: 1, records, shipId, hits, enemies, now });
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
    return { truth, seen };
}

describe('何人かが同時に撃つ（サーバーは最後に書いた人が勝ち、書いた本人には返さない）', () => {
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
    );

    it('1 つの自機を乗り継いでも、前の人の分は消えず、二重にも数えない', () => {
        for (const seed of seeds) {
            const handoff = 1000 + 500 * hash01(seed, 0, 97);
            const rides = [
                [{ shipId: 'ship-0', from: 0, to: handoff }],
                [{ shipId: 'ship-0', from: handoff + 400, to: 3000 }],
                [{ shipId: 'ship-1', from: 100, to: 3000 }],
            ];
            const { truth, seen } = simulate(seed, rides);
            for (const hits of seen) expect(hits).toEqual(truth);
        }
    });
});
