/**
 * 自機の HP・無敵・やられ・復活の規則と、移動。
 * 時刻はエポックミリ秒。乗っている人の時計で書き、ほかの人は自分の時計で点滅などを近似する。
 */

import { asFieldData, readBoolean, readNumber } from './fields';
import { clamp, clampRectInto, type Rect } from './geometry';

export interface ShipRules {
    readonly maxHp: number;
    readonly invincibleMs: number;
    readonly respawnMs: number;
}

export interface ShipStatus {
    readonly hp: number;
    /** 最後に被弾した時刻。0 は被弾していない。 */
    readonly hitAt: number;
    /** HP が 0 になった時刻。0 はやられていない。 */
    readonly downAt: number;
}

const BLINK_MS = 80;
/** 1 フレームで進める時間の上限。タブが裏に回った後などに壁抜けのように飛ばない。 */
export const MAX_STEP_SECONDS = 0.1;
/** 低速移動（Shift）のときの速さの割合。 */
export const FOCUS_SPEED_SCALE = 0.45;

export function shipRulesOf(data: unknown): ShipRules {
    const fields = asFieldData(data);
    return {
        maxHp: Math.round(readNumber(fields, 'maxHp', { fallback: 5, min: 1, max: 20 })),
        invincibleMs: readNumber(fields, 'invincibleSeconds', { fallback: 2, min: 0, max: 10 }) * 1000,
        respawnMs: readNumber(fields, 'respawnSeconds', { fallback: 3, min: 0.5, max: 30 }) * 1000,
    };
}

export interface ShipControls {
    readonly speed: number;
    readonly fireRate: number;
    readonly bulletSpeed: number;
    readonly autoFire: boolean;
    readonly hitRadius: number;
}

/** 動き・撃ち方の設定。乗っていない自機の data は誰でも書けるので、Inspector と同じ範囲に収める。 */
export function shipControlsOf(data: unknown): ShipControls {
    const fields = asFieldData(data);
    return {
        speed: readNumber(fields, 'speed', { fallback: 200, min: 20, max: 600 }),
        fireRate: readNumber(fields, 'fireRate', { fallback: 8, min: 1, max: 30 }),
        bulletSpeed: readNumber(fields, 'bulletSpeed', { fallback: 420, min: 50, max: 1000 }),
        autoFire: readBoolean(fields, 'autoFire', true),
        hitRadius: readNumber(fields, 'hitRadius', { fallback: 4, min: 1, max: 16 }),
    };
}

const time = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** 同期された値（他人が書いたものも含む）を読む。HP は 0〜maxHp の整数に収める。 */
export function shipStatusOf(hp: unknown, hitAt: unknown, downAt: unknown, rules: ShipRules): ShipStatus {
    const rawHp = typeof hp === 'number' && Number.isFinite(hp) ? Math.round(hp) : rules.maxHp;
    return { hp: clamp(rawHp, 0, rules.maxHp), hitAt: time(hitAt), downAt: time(downAt) };
}

export function freshShip(rules: ShipRules): ShipStatus {
    return { hp: rules.maxHp, hitAt: 0, downAt: 0 };
}

export function isDown(status: ShipStatus): boolean {
    return status.downAt > 0;
}

/** 被弾直後の無敵の間か。時計が戻って被弾が「未来」になっても、無敵の長さより先なら無敵にしない。 */
export function isInvincible(status: ShipStatus, rules: ShipRules, now: number): boolean {
    if (isDown(status) || status.hitAt === 0) return false;
    return Math.abs(now - status.hitAt) < rules.invincibleMs;
}

export function canBeHit(status: ShipStatus, rules: ShipRules, now: number): boolean {
    return !isDown(status) && !isInvincible(status, rules, now);
}

export function takeHit(status: ShipStatus, rules: ShipRules, now: number): ShipStatus {
    if (!canBeHit(status, rules, now)) return status;
    const hp = Math.max(0, status.hp - 1);
    const at = Math.max(1, now);
    return { hp, hitAt: at, downAt: hp === 0 ? at : 0 };
}

export function shouldRespawn(status: ShipStatus, rules: ShipRules, now: number): boolean {
    return isDown(status) && Math.abs(now - status.downAt) >= rules.respawnMs;
}

/** 復活した直後は無敵にする（復活した場所に弾があっても、すぐにはやられない）。 */
export function respawned(rules: ShipRules, now: number): ShipStatus {
    return { hp: rules.maxHp, hitAt: Math.max(1, now), downAt: 0 };
}

/** 復活までの残り秒（切り上げ）。やられていなければ 0。 */
export function respawnCountdown(status: ShipStatus, rules: ShipRules, now: number): number {
    if (!isDown(status)) return 0;
    return Math.max(0, Math.ceil((rules.respawnMs - Math.abs(now - status.downAt)) / 1000));
}

/** 無敵の間は点滅する。やられている間は見せない。 */
export function shipVisible(status: ShipStatus, rules: ShipRules, now: number): boolean {
    if (isDown(status)) return false;
    if (!isInvincible(status, rules, now)) return true;
    return Math.floor(Math.abs(now - status.hitAt) / BLINK_MS) % 2 === 0;
}

export interface MoveInput {
    readonly dx: number;
    readonly dy: number;
    readonly focus: boolean;
}

export function moveInput(pressed: (code: string) => boolean): MoveInput {
    const axis = (minus: string, plus: string): number => (pressed(plus) ? 1 : 0) - (pressed(minus) ? 1 : 0);
    return {
        dx: axis('ArrowLeft', 'ArrowRight'),
        dy: axis('ArrowUp', 'ArrowDown'),
        focus: pressed('ShiftLeft') || pressed('ShiftRight'),
    };
}

/** 入力の向きへ動かし、範囲の中に収める。斜めでも速さは変わらない。 */
export function moveShip<T extends Rect>(box: T, input: MoveInput, speed: number, seconds: number, area: Rect): T {
    const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, MAX_STEP_SECONDS);
    const len = Math.hypot(input.dx, input.dy);
    const step = len === 0 ? 0 : (Math.max(0, speed) * dt * (input.focus ? FOCUS_SPEED_SCALE : 1)) / len;
    return clampRectInto({ ...box, x: box.x + input.dx * step, y: box.y + input.dy * step }, area);
}

/** 復活する位置: 範囲の下の真ん中。 */
export function respawnBox<T extends Rect>(box: T, area: Rect): T {
    return clampRectInto({ ...box, x: area.x + (area.w - box.w) / 2, y: area.y + area.h - box.h - 48 }, area);
}

/** 演出に使う、同期された被弾・撃墜の時刻。 */
export interface ShipMarks {
    readonly hitAt: number;
    readonly downAt: number;
}

export function shipMarksOf(data: unknown): ShipMarks {
    const fields = asFieldData(data);
    return { hitAt: time(fields.hitAt), downAt: time(fields.downAt) };
}
