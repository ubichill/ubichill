/**
 * 敵（danmaku:enemy）の設定と、ステージの時刻から決まる位置・状態。
 * 同じ設定と同じ時刻なら、どのクライアントでも同じ位置になる（乱数や前のフレームの状態を使わない）。
 */

import { asFieldData, readColor, readEnum, readInteger, readNumber } from './fields';
import { clamp, type Vec } from './geometry';

export const ENEMY_MOTIONS = ['none', 'sway', 'circle'] as const;
export type EnemyMotion = (typeof ENEMY_MOTIONS)[number];

export const BULLET_PATTERNS = ['radial', 'spiral', 'aimed', 'rain'] as const;
export type BulletPattern = (typeof BULLET_PATTERNS)[number];

/** 画面の上から降りてくる時間と距離。降りている間は撃たない。 */
export const ENTRY_SECONDS = 0.8;
export const ENTRY_DISTANCE = 160;
/** leaveAt を過ぎたら上へ抜けていく。 */
export const EXIT_SECONDS = 1;
export const EXIT_DISTANCE = 240;
/** 降り切ってから最初の弾までの間。 */
export const FIRST_VOLLEY_DELAY = 0.4;

const DEFAULT_SIZE = 40;

export interface EnemySpec {
    readonly id: string;
    readonly home: Vec;
    readonly radius: number;
    readonly hp: number;
    readonly appearAt: number;
    /** null なら倒されるまで居続ける。 */
    readonly leaveAt: number | null;
    readonly motion: EnemyMotion;
    readonly range: number;
    readonly period: number;
    readonly pattern: BulletPattern;
    readonly count: number;
    readonly interval: number;
    readonly bulletSpeed: number;
    /** ラジアン */
    readonly spread: number;
    readonly color: string;
}

export interface EnemySource {
    readonly id: string;
    readonly transform: { readonly x: number; readonly y: number; readonly w?: number; readonly h?: number };
    readonly data: unknown;
}

const finite = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function enemySpecOf(source: EnemySource): EnemySpec {
    const data = asFieldData(source.data);
    const w = finite(source.transform.w, 0) > 0 ? finite(source.transform.w, DEFAULT_SIZE) : DEFAULT_SIZE;
    const h = finite(source.transform.h, 0) > 0 ? finite(source.transform.h, DEFAULT_SIZE) : DEFAULT_SIZE;
    const appearAt = readNumber(data, 'appearAt', { fallback: 0, min: 0, max: 3600 });
    const rawLeave = readNumber(data, 'leaveAt', { fallback: 0, min: 0, max: 3600 });
    return {
        id: source.id,
        home: { x: finite(source.transform.x, 0) + w / 2, y: finite(source.transform.y, 0) + h / 2 },
        radius: Math.max(6, Math.min(w, h) / 2),
        hp: readInteger(data, 'hp', { fallback: 20, min: 1, max: 999 }),
        appearAt,
        leaveAt: rawLeave > 0 ? Math.max(rawLeave, appearAt + ENTRY_SECONDS) : null,
        motion: readEnum(data, 'motion', ENEMY_MOTIONS, 'sway'),
        range: readNumber(data, 'range', { fallback: 80, min: 0, max: 400 }),
        period: readNumber(data, 'period', { fallback: 4, min: 0.5, max: 60 }),
        pattern: readEnum(data, 'pattern', BULLET_PATTERNS, 'radial'),
        count: readInteger(data, 'count', { fallback: 12, min: 1, max: 64 }),
        interval: readNumber(data, 'interval', { fallback: 1, min: 0.05, max: 10 }),
        bulletSpeed: readNumber(data, 'bulletSpeed', { fallback: 120, min: 20, max: 600 }),
        spread: (readNumber(data, 'spread', { fallback: 30, min: 0, max: 360 }) * Math.PI) / 180,
        color: readColor(data, 'color', '#f472b6'),
    };
}

export type EnemyPhase = 'waiting' | 'entering' | 'active' | 'leaving' | 'gone';

export function activeFrom(spec: EnemySpec): number {
    return spec.appearAt + ENTRY_SECONDS;
}

export function enemyPhase(spec: EnemySpec, t: number): EnemyPhase {
    if (t < spec.appearAt) return 'waiting';
    if (t < activeFrom(spec)) return 'entering';
    if (spec.leaveAt === null || t < spec.leaveAt) return 'active';
    return t < spec.leaveAt + EXIT_SECONDS ? 'leaving' : 'gone';
}

/** 画面に出ていて、自機の弾が当たる状態か。 */
export function isOnStage(phase: EnemyPhase): boolean {
    return phase === 'entering' || phase === 'active' || phase === 'leaving';
}

function motionOffset(spec: EnemySpec, activeSeconds: number): Vec {
    const angle = (2 * Math.PI * Math.max(0, activeSeconds)) / spec.period;
    if (spec.motion === 'sway') return { x: spec.range * Math.sin(angle), y: 0 };
    // 円の一番上から回り始める（降りてきた位置から途切れずにつながる）
    if (spec.motion === 'circle') return { x: spec.range * Math.sin(angle), y: spec.range * (1 - Math.cos(angle)) };
    return { x: 0, y: 0 };
}

const easeOut = (p: number): number => 1 - (1 - p) ** 2;
const easeIn = (p: number): number => p * p;

export function enemyPosition(spec: EnemySpec, t: number): Vec {
    const motion = motionOffset(spec, t - activeFrom(spec));
    const entry = clamp((t - spec.appearAt) / ENTRY_SECONDS, 0, 1);
    const exit = spec.leaveAt === null ? 0 : clamp((t - spec.leaveAt) / EXIT_SECONDS, 0, 1);
    return {
        x: spec.home.x + motion.x,
        y: spec.home.y + motion.y - ENTRY_DISTANCE * (1 - easeOut(entry)) - EXIT_DISTANCE * easeIn(exit),
    };
}
