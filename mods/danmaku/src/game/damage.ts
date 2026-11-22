/**
 * 各自が与えたダメージの記録。範囲（danmaku:canvas）の data の「枠」（`damage0`〜）に、人ごとに 1 つ書く。
 *
 * 人ごとのキーにしないのは、Entity の data のキーを消せないため（null を書いてもキーは残る）。人ごとのキーだと
 * 遊んだ人が増えるほど範囲の Entity が大きくなり続け、上限（64KB）に届くとラウンドの時刻も書けなくなる。
 * 枠は前のラウンドのものを使い回すので、大きさは枠の数までで止まる。
 *
 * 2 人が同時に同じ枠に書くと片方が消えるが、消えた側は空いている別の枠に書き直す。そのとき同じ人の記録が
 * 2 つの枠に残ることがあるので、読むときは人ごとに敵ごとの大きい方を取る（二重に数えない）。
 */

import { clamp } from './geometry';
import { hashString } from './patterns';
import { type Hits, sumHits } from './stage';

/** 手元で持つ自分の分。 */
export interface DamageEntry {
    readonly round: number;
    readonly hits: Hits;
}

/** 部屋に書く 1 枠。 */
export interface DamageSlot extends DamageEntry {
    readonly user: string;
}

export const MAX_DAMAGE_SLOTS = 16;
/** 当たるたびには書かず、この間隔でまとめて書く（連射で毎フレーム書かない）。倒した当たりはすぐ書く。 */
export const DAMAGE_WRITE_MS = 150;
/** 枠の合計をこの大きさまでにする（Entity の上限 64KB の半分。ラウンドの時刻など、ほかの値の分を残す）。 */
const DAMAGE_BUDGET_BYTES = 32_768;
/** 1 枠の大きさの見積もり（ID は 40 文字くらいまで）。 */
const slotBytes = (enemies: number): number => 120 + 50 * enemies;
const MAX_HITS = 100_000;
const MAX_USER_LENGTH = 256;

export const damageKey = (slot: number): string => `damage${slot}`;

/** 敵が多いステージでは枠を減らし、全部の枠が埋まっても Entity の上限に届かないようにする。 */
export function damageSlotCount(enemyCount: number): number {
    return clamp(Math.floor(DAMAGE_BUDGET_BYTES / slotBytes(Math.max(0, enemyCount))), 1, MAX_DAMAGE_SLOTS);
}

const nonNegativeInteger = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** 書かれた枠（ほかの人が書いたものを含む）を読む。崩れていれば空きとみなす。 */
export function parseDamageSlot(value: unknown): DamageSlot | null {
    if (typeof value !== 'object' || value === null) return null;
    const { round, user, hits } = value as { round?: unknown; user?: unknown; hits?: unknown };
    const parsedRound = nonNegativeInteger(round);
    if (parsedRound === null || typeof user !== 'string' || user === '' || user.length > MAX_USER_LENGTH) return null;
    if (typeof hits !== 'object' || hits === null || Array.isArray(hits)) return null;
    return {
        round: parsedRound,
        user,
        hits: Object.fromEntries(
            Object.entries(hits).flatMap(([id, count]) => {
                const n = nonNegativeInteger(count);
                return n === null ? [] : [[id, Math.min(n, MAX_HITS)]];
            }),
        ),
    };
}

/** 全部の枠（番号順。空き・崩れた枠は null）。 */
export function readDamageSlots(data: Readonly<Record<string, unknown>>): (DamageSlot | null)[] {
    return Array.from({ length: MAX_DAMAGE_SLOTS }, (_, i) => parseDamageSlot(data[damageKey(i)]));
}

const maxHits = (all: readonly Hits[]): Hits => {
    const ids = new Set(all.flatMap((hits) => Object.keys(hits)));
    return Object.fromEntries([...ids].map((id) => [id, Math.max(...all.map((hits) => hits[id] ?? 0))]));
};

/** ラウンドの全員のダメージ。except の人（自分。手元の値を使う）は数えない。 */
export function roundHits(slots: readonly (DamageSlot | null)[], round: number, except?: string): Hits {
    const entries = slots.filter((slot): slot is DamageSlot => slot !== null && slot.round === round);
    const users = [...new Set(entries.map((slot) => slot.user))].filter((user) => user !== except);
    return sumHits(users.map((user) => maxHits(entries.filter((slot) => slot.user === user).map((s) => s.hits))));
}

/** 起動したとき、部屋に残っている自分の分（一番新しいラウンド）から始める。 */
export function myDamage(slots: readonly (DamageSlot | null)[], user: string | undefined): DamageEntry | null {
    const mine = slots.filter((slot): slot is DamageSlot => slot !== null && slot.user === user);
    if (mine.length === 0) return null;
    const round = Math.max(...mine.map((slot) => slot.round));
    return { round, hits: maxHits(mine.filter((slot) => slot.round === round).map((slot) => slot.hits)) };
}

/** 自分のダメージに足す。ラウンドが変わっていたら前の分は捨てる。 */
export function addHits(entry: DamageEntry | null, round: number, hits: Hits): DamageEntry {
    const base = entry && entry.round === round ? entry.hits : {};
    const added = Object.fromEntries(Object.entries(hits).map(([id, count]) => [id, Math.max(0, count)]));
    return {
        round,
        hits: Object.fromEntries(
            Object.entries(sumHits([base, added])).map(([id, count]) => [id, Math.min(count, MAX_HITS)]),
        ),
    };
}

const covers = (slot: DamageSlot, user: string, mine: DamageEntry): boolean =>
    slot.user === user &&
    slot.round === mine.round &&
    Object.entries(mine.hits).every(([id, count]) => (slot.hits[id] ?? 0) >= count);

/**
 * 自分が書く枠。このラウンドの自分の枠があればそれ。無ければ、名前から決まる番号から順に、空き・前のラウンド・
 * 自分の枠を探す（同時に書き始めた人どうしがぶつかりにくい）。このラウンドのほかの人で埋まっていれば null。
 */
export function damageSlotFor(
    slots: readonly (DamageSlot | null)[],
    user: string,
    round: number,
    count: number,
): number | null {
    const usable = clamp(Math.floor(count), 1, Math.min(MAX_DAMAGE_SLOTS, slots.length));
    const own = slots.findIndex((slot, i) => i < usable && slot?.user === user && slot.round === round);
    if (own >= 0) return own;
    const start = hashString(user) % usable;
    const order = Array.from({ length: usable }, (_, i) => (start + i) % usable);
    return order.find((i) => slots[i] === null || slots[i]?.round !== round || slots[i]?.user === user) ?? null;
}

export interface DamageWriteInput {
    readonly slots: readonly (DamageSlot | null)[];
    readonly user: string | undefined;
    /** 手元の自分の分（正）。 */
    readonly mine: DamageEntry | null;
    readonly round: number;
    readonly enemyCount: number;
    /** このフレームの当たりで敵を倒した（ほかの人の画面でもすぐ倒れるよう、待たずに書く）。 */
    readonly urgent: boolean;
    readonly now: number;
    readonly lastWriteAt: number;
}

export interface DamageWrite {
    readonly key: string;
    readonly value: DamageSlot;
}

/**
 * 今書くべきダメージ。自分の分が枠に全部載っていれば書かない（ほかの人に枠を上書きされたら、また書く）。
 * 前に書いてから DAMAGE_WRITE_MS 経つまでは、倒した当たりのとき以外ためておく。
 */
export function pendingDamageWrite(input: DamageWriteInput): DamageWrite | null {
    const { user, mine } = input;
    if (!user || !mine || mine.round !== input.round || Object.keys(mine.hits).length === 0) return null;
    if (input.slots.some((slot) => slot !== null && covers(slot, user, mine))) return null;
    if (!input.urgent && Math.abs(input.now - input.lastWriteAt) < DAMAGE_WRITE_MS) return null;
    const slot = damageSlotFor(input.slots, user, input.round, damageSlotCount(input.enemyCount));
    return slot === null ? null : { key: damageKey(slot), value: { round: mine.round, user, hits: mine.hits } };
}
