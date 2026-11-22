import { describe, expect, it } from 'vitest';
import {
    addHits,
    DAMAGE_WRITE_MS,
    type DamageEntry,
    type DamageSlot,
    type DamageWriteInput,
    damageKey,
    damageSlotCount,
    damageSlotFor,
    MAX_DAMAGE_SLOTS,
    myDamage,
    parseDamageSlot,
    pendingDamageWrite,
    readDamageSlots,
    roundHits,
} from './damage';

const slot = (user: string, round: number, hits: Record<string, number>): DamageSlot => ({ user, round, hits });
const empty = (): (DamageSlot | null)[] => Array.from({ length: MAX_DAMAGE_SLOTS }, () => null);
const withSlots = (entries: Record<number, DamageSlot>) => empty().map((s, i) => entries[i] ?? s);

describe('枠を読む（ほかの人が書いた値も信用しない）', () => {
    it('崩れた枠は空きとみなし、負・NaN の数は捨てる', () => {
        expect(parseDamageSlot(null)).toBeNull();
        expect(parseDamageSlot({ round: 1, hits: {} })).toBeNull();
        expect(parseDamageSlot({ round: 1, user: '', hits: {} })).toBeNull();
        expect(parseDamageSlot({ round: 1, user: 'x'.repeat(257), hits: {} })).toBeNull();
        expect(parseDamageSlot({ round: -1, user: 'a', hits: {} })).toBeNull();
        expect(parseDamageSlot({ round: 1, user: 'a', hits: [3] })).toBeNull();
        expect(parseDamageSlot({ round: 1, user: 'a', hits: { a: 3, b: -2, c: Number.NaN, d: '4' } })).toEqual(
            slot('a', 1, { a: 3 }),
        );
    });

    it('枠の番号のキーだけを読む（前の形の `damage:<userId>`・範囲外の番号は読まない）', () => {
        const slots = readDamageSlots({
            [damageKey(0)]: slot('a', 1, { e: 1 }),
            [damageKey(MAX_DAMAGE_SLOTS - 1)]: slot('b', 1, { e: 2 }),
            [damageKey(MAX_DAMAGE_SLOTS)]: slot('c', 1, { e: 3 }),
            'damage:d': { round: 1, hits: { e: 4 } },
            round: 1,
        });
        expect(slots).toHaveLength(MAX_DAMAGE_SLOTS);
        expect(slots.filter((s) => s !== null).map((s) => s?.user)).toEqual(['a', 'b']);
    });
});

describe('roundHits・myDamage', () => {
    it('このラウンドの分だけを人ごとに足し、自分（手元の値を使う）は数えない', () => {
        const slots = withSlots({
            0: slot('a', 2, { e: 3, f: 1 }),
            3: slot('b', 2, { e: 4 }),
            5: slot('me', 2, { e: 100 }),
            7: slot('c', 1, { e: 99 }),
        });
        expect(roundHits(slots, 2, 'me')).toEqual({ e: 7, f: 1 });
        expect(roundHits(slots, 3, 'me')).toEqual({});
    });

    it('同じ人が 2 つの枠に書いていても二重に数えず、敵ごとに大きい方を取る', () => {
        const slots = withSlots({ 1: slot('a', 2, { e: 5, f: 1 }), 9: slot('a', 2, { e: 3, f: 4 }) });
        expect(roundHits(slots, 2)).toEqual({ e: 5, f: 4 });
    });

    it('起動したときは、部屋に残っている自分の一番新しいラウンドの分から始める', () => {
        const slots = withSlots({
            0: slot('me', 1, { e: 9 }),
            2: slot('me', 3, { e: 2 }),
            4: slot('me', 3, { f: 1 }),
            6: slot('you', 4, { e: 1 }),
        });
        expect(myDamage(slots, 'me')).toEqual({ round: 3, hits: { e: 2, f: 1 } });
        expect(myDamage(slots, 'nobody')).toBeNull();
        expect(myDamage(slots, undefined)).toBeNull();
    });

    it('ラウンドが変わったら前の分を捨ててから足す', () => {
        const before = { round: 1, hits: { a: 10 } };
        expect(addHits(before, 1, { a: 2, b: 1 })).toEqual({ round: 1, hits: { a: 12, b: 1 } });
        expect(addHits(before, 2, { b: 1 })).toEqual({ round: 2, hits: { b: 1 } });
    });
});

describe('枠の選び方と大きさ', () => {
    it('このラウンドの自分の枠があればそれを使い、無ければ空き・前のラウンドの枠を使う', () => {
        const mine = withSlots({ 6: slot('me', 2, { e: 1 }) });
        expect(damageSlotFor(mine, 'me', 2, MAX_DAMAGE_SLOTS)).toBe(6);
        const stale = withSlots(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, slot(`u${i}`, 1, {})])));
        expect(damageSlotFor(stale, 'me', 2, MAX_DAMAGE_SLOTS)).not.toBeNull();
    });

    it('このラウンドのほかの人で全部埋まっていれば書かない（ほかの人の枠を上書きしない）', () => {
        const full = withSlots(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, slot(`u${i}`, 2, {})])));
        expect(damageSlotFor(full, 'me', 2, MAX_DAMAGE_SLOTS)).toBeNull();
        const oneFree = full.map((s, i) => (i === 11 ? null : s));
        expect(damageSlotFor(oneFree, 'me', 2, MAX_DAMAGE_SLOTS)).toBe(11);
        // 使える枠の数より後ろの空きは使わない
        expect(damageSlotFor(oneFree, 'me', 2, 8)).toBeNull();
    });

    it('同時に書き始めた人どうしは、名前から決まる別々の枠から探し始める', () => {
        const users = Array.from({ length: 8 }, (_, i) => `user-${i}`);
        const first = new Set(users.map((user) => damageSlotFor(empty(), user, 1, MAX_DAMAGE_SLOTS)));
        expect(first.size).toBeGreaterThan(4);
    });

    it.each([0, 9, 60, 300, 600])(
        '敵 %i 体で全部の枠が埋まっても、枠の合計は Entity の上限の半分に収まる',
        (enemies) => {
            const count = damageSlotCount(enemies);
            const hits = Object.fromEntries(
                Array.from({ length: enemies }, (_, i) => [`${'x'.repeat(36)}${i}`, 100_000]),
            );
            const data = Object.fromEntries(
                Array.from({ length: count }, (_, i) => [damageKey(i), slot('u'.repeat(64), 999_999, hits)]),
            );
            expect(count).toBeGreaterThanOrEqual(1);
            expect(count).toBeLessThanOrEqual(MAX_DAMAGE_SLOTS);
            expect(JSON.stringify(data).length).toBeLessThanOrEqual(32_768);
        },
    );

    it('人が何人入れ替わっても、書く枠は増えない', () => {
        const data = Array.from({ length: 500 }, (_, i) => i).reduce<Record<string, unknown>>((acc, i) => {
            const write = pendingDamageWrite({
                slots: readDamageSlots(acc),
                user: `player-${i}`,
                mine: { round: i, hits: { e: 1 } },
                round: i,
                enemyCount: 9,
                urgent: true,
                now: i * 1000,
                lastWriteAt: 0,
            });
            return write ? Object.fromEntries([...Object.entries(acc), [write.key, write.value]]) : acc;
        }, {});
        expect(Object.keys(data).length).toBeLessThanOrEqual(MAX_DAMAGE_SLOTS);
    });
});

describe('pendingDamageWrite（当たるたびに書かず、まとめて書く）', () => {
    const base = (over: Partial<DamageWriteInput>): DamageWriteInput => ({
        slots: empty(),
        user: 'me',
        mine: { round: 1, hits: { e: 1 } },
        round: 1,
        enemyCount: 9,
        urgent: false,
        now: 10_000,
        lastWriteAt: 0,
        ...over,
    });

    it('60fps で 1 秒撃ち続けても、書くのは間隔ごとの数回だけで、最後の分も書き残さない', () => {
        type Run = { slots: (DamageSlot | null)[]; mine: DamageEntry | null; lastWriteAt: number; writes: number };
        const frames = Array.from({ length: 60 }, (_, i) => 10_000 + (i * 1000) / 60);
        const run = frames.reduce<Run>(
            (acc, now) => {
                const mine = addHits(acc.mine, 1, { e: 1 });
                const write = pendingDamageWrite(base({ slots: acc.slots, mine, now, lastWriteAt: acc.lastWriteAt }));
                if (!write) return { slots: acc.slots, mine, lastWriteAt: acc.lastWriteAt, writes: acc.writes };
                const slots = acc.slots.map((s, i) => (damageKey(i) === write.key ? write.value : s));
                return { slots, mine, lastWriteAt: now, writes: acc.writes + 1 };
            },
            { slots: empty(), mine: null, lastWriteAt: 0, writes: 0 },
        );
        expect(run.writes).toBeGreaterThanOrEqual(Math.floor(1000 / DAMAGE_WRITE_MS));
        expect(run.writes).toBeLessThanOrEqual(Math.ceil(1000 / DAMAGE_WRITE_MS) + 1);
        // 撃つのをやめても、ためていた分は間隔が過ぎたら書く
        const flush = pendingDamageWrite(
            base({
                slots: run.slots,
                mine: run.mine,
                now: run.lastWriteAt + DAMAGE_WRITE_MS,
                lastWriteAt: run.lastWriteAt,
            }),
        );
        expect(flush?.value.hits).toEqual({ e: 60 });
    });

    it('倒した当たりは間隔を待たずにすぐ書く', () => {
        expect(pendingDamageWrite(base({ lastWriteAt: 9_990 }))).toBeNull();
        expect(pendingDamageWrite(base({ lastWriteAt: 9_990, urgent: true }))?.value).toEqual(slot('me', 1, { e: 1 }));
    });

    it('枠に全部載っていれば書かない。ほかの人に上書きされたら、別の枠に書き直す', () => {
        const saved = withSlots({ 4: slot('me', 1, { e: 1 }) });
        expect(pendingDamageWrite(base({ slots: saved }))).toBeNull();
        const taken = pendingDamageWrite(base({ slots: withSlots({ 4: slot('you', 1, { e: 7 }) }) }));
        expect(taken).not.toBeNull();
        expect(taken?.value.user).toBe('me');
    });

    it('書く人が分からない・ほかのラウンドの分・当たっていないときは書かない', () => {
        expect(pendingDamageWrite(base({ user: undefined }))).toBeNull();
        expect(pendingDamageWrite(base({ mine: { round: 0, hits: { e: 1 } } }))).toBeNull();
        expect(pendingDamageWrite(base({ mine: { round: 1, hits: {} } }))).toBeNull();
        expect(pendingDamageWrite(base({ mine: null }))).toBeNull();
    });

    it('時計が戻っても待ち続けない（差の大きさで測る）', () => {
        expect(pendingDamageWrite(base({ now: 1_000, lastWriteAt: 10_000 }))).not.toBeNull();
    });
});
