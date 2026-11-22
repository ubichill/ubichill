/**
 * ステージの進み方。部屋で共有するのは「何ラウンド目か」と「始まった時刻」と、各自が与えたダメージだけ。
 * 敵の出現・弾・クリアはそこから各クライアントが計算する。
 *
 * ダメージは人ごとのキー（`damage:<userId>`）に自分の分だけ書く。同じキーを複数人で上書きし合わないので、
 * 同時に撃っても当たりが消えない。どのラウンドの分かを一緒に持ち、前のラウンドの分は数えない。
 */

import { type EnemySpec, enemyPhase } from './enemy';

export interface StageClock {
    readonly round: number;
    /** エポックミリ秒。0 はまだ始まっていない。 */
    readonly startedAt: number;
}

export interface DamageEntry {
    readonly round: number;
    readonly hits: Readonly<Record<string, number>>;
}

export type Hits = Readonly<Record<string, number>>;

export type StageStatus =
    | { readonly kind: 'idle' }
    | { readonly kind: 'running'; readonly seconds: number; readonly defeated: number; readonly total: number }
    | { readonly kind: 'cleared'; readonly seconds: number; readonly defeated: number; readonly total: number };

export const DAMAGE_KEY_PREFIX = 'damage:';
/** 全部倒した・去ってから、次のラウンドまでの間。 */
export const CLEAR_DELAY_MS = 3000;
const MAX_HITS = 100_000;

const nonNegativeInteger = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

export function readClock(round: unknown, startedAt: unknown): StageClock {
    return { round: nonNegativeInteger(round) ?? 0, startedAt: nonNegativeInteger(startedAt) ?? 0 };
}

/** ラウンドの経過秒。始まっていなければ null。始まりが未来（時計のずれ）なら負になる。 */
export function stageSeconds(clock: StageClock, now: number): number | null {
    return clock.startedAt > 0 ? (now - clock.startedAt) / 1000 : null;
}

export function parseDamageEntry(value: unknown): DamageEntry | null {
    if (typeof value !== 'object' || value === null) return null;
    const { round, hits } = value as { round?: unknown; hits?: unknown };
    const parsedRound = nonNegativeInteger(round);
    if (parsedRound === null || typeof hits !== 'object' || hits === null || Array.isArray(hits)) return null;
    return {
        round: parsedRound,
        hits: Object.fromEntries(
            Object.entries(hits).flatMap(([id, count]) => {
                const n = nonNegativeInteger(count);
                return n === null ? [] : [[id, Math.min(n, MAX_HITS)]];
            }),
        ),
    };
}

/** 自分以外の人のダメージ（自分の分は書いたばかりの値を使うので、届いた値は使わない）。 */
export function othersDamage(data: Readonly<Record<string, unknown>>, myUserId: string | undefined): DamageEntry[] {
    return Object.entries(data).flatMap(([key, value]) => {
        if (!key.startsWith(DAMAGE_KEY_PREFIX) || key === `${DAMAGE_KEY_PREFIX}${myUserId}`) return [];
        const entry = parseDamageEntry(value);
        return entry ? [entry] : [];
    });
}

/** 敵ごとの数を足し合わせる。 */
export function sumHits(all: readonly Hits[]): Hits {
    const ids = new Set(all.flatMap((hits) => Object.keys(hits)));
    return Object.fromEntries([...ids].map((id) => [id, all.reduce((sum, hits) => sum + (hits[id] ?? 0), 0)]));
}

export function totalHits(entries: readonly DamageEntry[], round: number): Hits {
    return sumHits(entries.filter((entry) => entry.round === round).map((entry) => entry.hits));
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

export function isDefeated(spec: EnemySpec, hits: Hits): boolean {
    return (hits[spec.id] ?? 0) >= spec.hp;
}

export function remainingHp(spec: EnemySpec, hits: Hits): number {
    return Math.max(0, spec.hp - (hits[spec.id] ?? 0));
}

export function stageStatus(clock: StageClock, now: number, enemies: readonly EnemySpec[], hits: Hits): StageStatus {
    const seconds = stageSeconds(clock, now);
    if (seconds === null || enemies.length === 0) return { kind: 'idle' };
    const defeated = enemies.filter((spec) => isDefeated(spec, hits)).length;
    const done = enemies.every((spec) => isDefeated(spec, hits) || enemyPhase(spec, seconds) === 'gone');
    return { kind: done ? 'cleared' : 'running', seconds, defeated, total: enemies.length };
}

/** 敵と弾を動かす経過秒。始まっていないとき・ラウンドが終わったあと（残った弾も消す）は null。 */
export function playingSeconds(
    clock: StageClock,
    now: number,
    enemies: readonly EnemySpec[],
    hits: Hits,
): number | null {
    return stageStatus(clock, now, enemies, hits).kind === 'running' ? stageSeconds(clock, now) : null;
}

/**
 * 次のラウンドの開始時刻。秒の切れ目にそろえるので、何人かが同時に書いても同じ値になりやすい
 * （書いた本人には自分の書き込みが返ってこないので、値が違うと人によって時計がずれたままになる）。
 */
export function nextRoundStart(now: number, delayMs = 0): number {
    return Math.ceil((now + Math.max(0, delayMs)) / 1000) * 1000;
}

/** 始まったばかりのラウンドは、乗り直しでやり直さない（乗り降りの連打や通信の揺れでやり直し続けない）。 */
export const RESTART_GUARD_SECONDS = 2;

/** 自機に乗ったときに新しいラウンドを始めるか。ひとりなら最初から、ほかに乗っている人がいれば途中から加わる。 */
export function startsOnBoard(status: StageStatus, othersRiding: boolean): boolean {
    if (status.kind !== 'idle' && status.seconds < RESTART_GUARD_SECONDS) return false;
    return !othersRiding || status.kind === 'idle';
}

/** 時計が戻っても待ち続けないよう、差の大きさで測る。 */
export function clearDelayPassed(clearedSince: number | null, now: number): boolean {
    return clearedSince !== null && Math.abs(now - clearedSince) >= CLEAR_DELAY_MS;
}

export function mergeHits(base: Hits, more: Hits): Hits {
    return sumHits([base, more]);
}

/** 次のラウンドまでの残り秒（切り上げ）。 */
export function clearCountdown(clearedSince: number | null, now: number): number {
    if (clearedSince === null) return 0;
    return Math.max(0, Math.ceil((CLEAR_DELAY_MS - Math.abs(now - clearedSince)) / 1000));
}
