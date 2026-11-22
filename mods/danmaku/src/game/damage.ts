/**
 * 各自が与えたダメージの記録。乗っている自機の Entity の data（`damage:<範囲の ID>`）に、その自機で与えた分を書く。
 *
 * 乗っている自機は乗っている人しか書き換えられない（サーバーが lockedBy で断る）ので、同じ記録を 2 人が書いて
 * 消し合うことがない。範囲は、このラウンドの分を自機ごとに足す。乗る人が替わったら、次の人は自機の記録から続ける。
 * サーバーは書いた本人に書いた値を返さないので、乗っている自機の分は手元の値を正とする。
 */

import type { EnemySpec } from './enemy';
import { type Hits, isDefeated, sumHits } from './stage';

export interface DamageRecord {
    readonly round: number;
    /** 最後に書いた人。自分が書いた値が戻ってきたのか、前に乗っていた人の書き込みが遅れて届いたのかを分ける。 */
    readonly by: string;
    readonly hits: Hits;
}

/** 当たるたびには書かず、この間隔でまとめて書く（連射で毎フレーム書かない）。倒した当たりはすぐ書く。 */
export const DAMAGE_WRITE_MS = 150;
/** 敵の HP の上限。これより多く数えても変わらないので、記録の数はここで止める。 */
export const MAX_RECORD_HITS = 999;
/** 1 つの記録の大きさの上限（自機の Entity の上限 64KB に、ほかの値と範囲いくつか分の記録が収まるように）。 */
export const RECORD_BUDGET_BYTES = 8192;
const RECORD_OVERHEAD_BYTES = 128;
const MAX_USER_LENGTH = 256;

export const damageKey = (areaId: string): string => `damage:${areaId}`;

const nonNegativeInteger = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

const capped = (hits: Hits): Hits =>
    Object.fromEntries(Object.entries(hits).map(([id, count]) => [id, Math.min(count, MAX_RECORD_HITS)]));

/** 書かれた記録（ほかの人が書いたものを含む）を読む。崩れていれば無いとみなす。 */
export function parseDamageRecord(value: unknown): DamageRecord | null {
    if (typeof value !== 'object' || value === null) return null;
    const { round, by, hits } = value as { round?: unknown; by?: unknown; hits?: unknown };
    const parsedRound = nonNegativeInteger(round);
    if (parsedRound === null || typeof by !== 'string' || by === '' || by.length > MAX_USER_LENGTH) return null;
    if (typeof hits !== 'object' || hits === null || Array.isArray(hits)) return null;
    return {
        round: parsedRound,
        by,
        hits: capped(
            Object.fromEntries(
                Object.entries(hits).flatMap(([id, count]) => {
                    const n = nonNegativeInteger(count);
                    return n === null ? [] : [[id, n]];
                }),
            ),
        ),
    };
}

/**
 * 範囲で動かす敵。記録（敵の ID ごとの数）が上限に収まる分まで、ID の順に選ぶ（どの画面でも同じ敵になる）。
 * 収まらない敵は現れない（書いた記録がサーバーに断られて、画面ごとに HP が食い違うよりよい）。
 */
export function stageEnemies(specs: readonly EnemySpec[]): EnemySpec[] {
    const sorted = [...specs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const sizes = sorted.map((spec) => JSON.stringify(spec.id).length + `:${MAX_RECORD_HITS},`.length);
    const ends = sizes.map((_, i) => sizes.slice(0, i + 1).reduce((sum, n) => sum + n, RECORD_OVERHEAD_BYTES));
    return sorted.filter((_, i) => ends[i] <= RECORD_BUDGET_BYTES);
}

/** 乗っている自機で、このラウンドに与えた分。base は乗った時点の自機の記録（前に乗っていた人の分）。 */
export interface Riding {
    readonly shipId: string;
    readonly round: number;
    readonly base: Hits;
    readonly own: Hits;
}

export interface DamageState {
    readonly riding: Riding | null;
    /** 最後に書いた記録（同じものを書き直さない・倒した当たりが書いてあるかを見る）。 */
    readonly written: { readonly shipId: string; readonly record: DamageRecord } | null;
    readonly lastWriteAt: number;
}

export const INITIAL_DAMAGE: DamageState = { riding: null, written: null, lastWriteAt: 0 };

export interface DamageView {
    readonly user: string | undefined;
    readonly round: number;
    /** この画面に見えている自機ごとの記録（data の値そのまま）。 */
    readonly records: ReadonlyMap<string, unknown>;
}

const maxHits = (a: Hits, b: Hits): Hits =>
    Object.fromEntries(
        [...new Set([...Object.keys(a), ...Object.keys(b)])].map((id) => [id, Math.max(a[id] ?? 0, b[id] ?? 0)]),
    );

const ridingTotal = (riding: Riding): Hits => capped(sumHits([riding.base, riding.own]));

const recordHits = (raw: unknown, round: number): Hits => {
    const record = parseDamageRecord(raw);
    return record && record.round === round ? record.hits : {};
};

/** 乗っている自機を除いた、ほかの自機の記録の合計。 */
function othersHits(view: DamageView, except: string | null): Hits {
    return sumHits(
        [...view.records].filter(([shipId]) => shipId !== except).map(([, raw]) => recordHits(raw, view.round)),
    );
}

/** このラウンドに全員が与えたダメージ。乗っている自機の分は手元の値を使う。 */
export function knownHits(state: DamageState, view: DamageView): Hits {
    const riding = state.riding?.round === view.round ? state.riding : null;
    return sumHits([othersHits(view, riding?.shipId ?? null), riding ? ridingTotal(riding) : {}]);
}

function nextRiding(prev: Riding | null, shipId: string | null, view: DamageView): Riding | null {
    if (shipId === null) return null;
    const record = parseDamageRecord(view.records.get(shipId));
    const current = record && record.round === view.round ? record : null;
    if (prev && prev.shipId === shipId && prev.round === view.round) {
        // 乗る前の人の書き込みが乗った後に届いたら、それも前の人の分として足す（自分が書いた値は手元にある）
        return current && current.by !== view.user ? { ...prev, base: maxHits(prev.base, current.hits) } : prev;
    }
    return { shipId, round: view.round, base: current?.hits ?? {}, own: {} };
}

export interface DamageStepInput extends DamageView {
    /** 今乗っている自機（乗っていなければ null）。 */
    readonly shipId: string | null;
    /** このフレームで自分の弾が与えた分。 */
    readonly hits: Hits;
    readonly enemies: readonly EnemySpec[];
    readonly now: number;
}

export interface DamageWrite {
    readonly shipId: string;
    readonly record: DamageRecord;
}

const sameHits = (a: Hits, b: Hits): boolean =>
    Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, n]) => b[id] === n);

/**
 * 1 フレーム分。自分の当たりを乗っている自機の分に足し、書くべき記録を返す。
 * - 前に書いた値と同じなら書かない。DAMAGE_WRITE_MS の間はためておく。
 * - ただし、この分で倒れる敵がいる（ほかの画面では、まだ倒れていない）ときはすぐ書く。
 * - 降りた・乗り換えたときは、ためていた分をすぐ書く（次の人が乗る前に届くように）。
 */
export function stepDamage(state: DamageState, input: DamageStepInput): { state: DamageState; writes: DamageWrite[] } {
    const prev = state.riding;
    const moved = nextRiding(prev, input.shipId, input);
    const riding =
        moved && Object.keys(input.hits).length > 0 ? { ...moved, own: sumHits([moved.own, input.hits]) } : moved;
    const user = input.user;
    if (!user) return { state: { ...state, riding }, writes: [] };

    const unwritten = (r: Riding): DamageRecord | null => {
        if (Object.keys(r.own).length === 0) return null;
        const record = { round: r.round, by: user, hits: ridingTotal(r) };
        const last = state.written;
        return last &&
            last.shipId === r.shipId &&
            last.record.round === r.round &&
            sameHits(last.record.hits, record.hits)
            ? null
            : record;
    };

    const left = prev && prev.shipId !== riding?.shipId ? unwritten(prev) : null;
    const leaving = prev && left ? [{ shipId: prev.shipId, record: left }] : [];
    const pending = riding ? unwritten(riding) : null;
    const due = (r: Riding, record: DamageRecord): boolean => {
        if (Math.abs(input.now - state.lastWriteAt) >= DAMAGE_WRITE_MS) return true;
        const others = othersHits(input, r.shipId);
        const last = state.written;
        const shown = last && last.shipId === r.shipId && last.record.round === r.round ? last.record.hits : r.base;
        return input.enemies.some(
            (spec) => isDefeated(spec, sumHits([others, record.hits])) && !isDefeated(spec, sumHits([others, shown])),
        );
    };
    const current = riding && pending && due(riding, pending) ? [{ shipId: riding.shipId, record: pending }] : [];
    const writes = [...leaving, ...current];
    const last = writes.at(-1);
    return {
        state: last ? { riding, written: last, lastWriteAt: input.now } : { ...state, riding },
        writes,
    };
}
