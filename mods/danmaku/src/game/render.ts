/**
 * 1 フレーム分の絵を canvas のカーソル（Path2D）の一覧にする。
 * 弾は色ごとに 1 つのパスへまとめる（数百発でも、送るのは数個のカーソル）。
 */

import type { CanvasCursorData } from 'ubichill';
import type { BulletPattern, EnemySpec } from './enemy';
import type { Rect, Vec } from './geometry';
import { type EnemyBullet, hash01 } from './patterns';
import type { ShipMarks } from './ship';
import type { Shot } from './shots';

/** spark: 弾が当たった火花、burst: 敵の撃破・自機の被弾、blast: 自機の撃墜。 */
export type EffectKind = 'burst' | 'spark' | 'blast';

export interface Effect {
    readonly kind: EffectKind;
    readonly x: number;
    readonly y: number;
    readonly color: string;
    /** 秒 */
    readonly age: number;
}

export const EFFECT_SECONDS: Record<EffectKind, number> = { burst: 0.6, spark: 0.15, blast: 1 };

export interface EnemyView {
    readonly spec: EnemySpec;
    readonly position: Vec;
    /** 0〜1 */
    readonly hpRatio: number;
    /** 当たった直後に白く光らせる。 */
    readonly flash: boolean;
}

export interface Scene {
    readonly area: Rect;
    /** 秒。敵の回転などの見た目にだけ使う。 */
    readonly clock: number;
    readonly enemies: readonly EnemyView[];
    readonly bullets: readonly EnemyBullet[];
    readonly shots: readonly Shot[];
    readonly effects: readonly Effect[];
    /** 自分が乗っている自機の当たり判定。乗っていなければ null。 */
    readonly hitbox: { readonly center: Vec; readonly radius: number } | null;
}

const BULLET_RADIUS = 6;
const BULLET_CORE_RADIUS = 2.6;
const FRAME_COLOR = 'rgba(125, 211, 252, 0.35)';
const MY_SHOT_COLOR = '#fde68a';
const OTHER_SHOT_COLOR = 'rgba(186, 230, 253, 0.75)';

const r1 = (v: number): number => Math.round(v * 10) / 10;

export function circlePath(x: number, y: number, r: number): string {
    return `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0Z`;
}

export function polygonPath(points: readonly Vec[]): string {
    if (points.length === 0) return '';
    return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r1(p.x)} ${r1(p.y)}`).join('')}Z`;
}

export function rectPath(x: number, y: number, w: number, h: number): string {
    return `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
}

/** 頂点を外側・内側と交互に並べた星形（inner = outer なら正多角形）。 */
export function starPoints(tips: number, outer: number, inner: number, rotation = 0): Vec[] {
    return Array.from({ length: tips * 2 }, (_, i) => {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = rotation - Math.PI / 2 + (Math.PI * i) / tips;
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
}

/** `#rgb` / `#rrggbb` に透明度を付ける。 */
export function withAlpha(hex: string, alpha: number): string {
    const full =
        hex.length === 4
            ? hex
                  .slice(1)
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : hex.slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

const custom = (
    x: number,
    y: number,
    pathFills: CanvasCursorData['pathFills'],
    pathStrokes?: CanvasCursorData['pathStrokes'],
    rotation?: number,
): CanvasCursorData => ({ x, y, color: '#ffffff', size: 0, shape: 'custom', pathFills, pathStrokes, rotation });

/** 弾の型ごとに形を変え、どの撃ち方の敵か見分けられるようにする。 */
const BODY: Record<BulletPattern, (r: number) => { outer: Vec[]; inner: Vec[] }> = {
    radial: (r) => ({ outer: starPoints(8, r, r * 0.92), inner: starPoints(8, r * 0.55, r * 0.5) }),
    spiral: (r) => ({ outer: starPoints(4, r * 1.15, r * 0.45), inner: starPoints(4, r * 0.5, r * 0.25) }),
    aimed: (r) => ({
        outer: [
            { x: 0, y: r },
            { x: -r, y: -r * 0.7 },
            { x: 0, y: -r * 0.3 },
            { x: r, y: -r * 0.7 },
        ],
        inner: [
            { x: 0, y: r * 0.45 },
            { x: -r * 0.35, y: -r * 0.25 },
            { x: r * 0.35, y: -r * 0.25 },
        ],
    }),
    rain: (r) => ({
        outer: starPoints(2, r * 1.1, r * 0.55, Math.PI / 2),
        inner: starPoints(2, r * 0.5, r * 0.25, Math.PI / 2),
    }),
};

const SPIN: Record<BulletPattern, number> = { radial: 0.6, spiral: 2.4, aimed: 0, rain: 0 };

function enemyCursors(view: EnemyView, clock: number): CanvasCursorData[] {
    const { spec, position } = view;
    const body = BODY[spec.pattern](spec.radius);
    const barWidth = spec.radius * 2;
    const barY = position.y - spec.radius - 12;
    return [
        custom(
            position.x,
            position.y,
            [
                { d: circlePath(0, 0, spec.radius * 1.25), fill: withAlpha(spec.color, 0.16) },
                { d: polygonPath(body.outer), fill: view.flash ? '#ffffff' : spec.color },
                { d: polygonPath(body.inner), fill: '#0b1020' },
                { d: circlePath(0, 0, spec.radius * 0.16), fill: view.flash ? spec.color : '#ffffff' },
            ],
            [{ d: polygonPath(body.outer), stroke: 'rgba(255, 255, 255, 0.55)', lineWidth: 1.5 }],
            clock * SPIN[spec.pattern],
        ),
        custom(position.x - barWidth / 2, barY, [
            { d: rectPath(0, 0, barWidth, 4), fill: 'rgba(255, 255, 255, 0.18)' },
            { d: rectPath(0, 0, barWidth * Math.max(0, Math.min(1, view.hpRatio)), 4), fill: spec.color },
        ]),
    ];
}

function bulletCursors(bullets: readonly EnemyBullet[]): CanvasCursorData[] {
    if (bullets.length === 0) return [];
    const colors = [...new Set(bullets.map((bullet) => bullet.color))];
    return [
        ...colors.map((color) => {
            const group = bullets.filter((bullet) => bullet.color === color);
            return custom(0, 0, [
                { d: group.map((b) => circlePath(b.x, b.y, BULLET_RADIUS + 2)).join(''), fill: withAlpha(color, 0.28) },
                { d: group.map((b) => circlePath(b.x, b.y, BULLET_RADIUS)).join(''), fill: color },
            ]);
        }),
        custom(0, 0, [{ d: bullets.map((b) => circlePath(b.x, b.y, BULLET_CORE_RADIUS)).join(''), fill: '#ffffff' }]),
    ];
}

function shotCursors(shots: readonly Shot[]): CanvasCursorData[] {
    const path = (mine: boolean): string =>
        shots
            .filter((shot) => shot.mine === mine)
            .map((shot) => rectPath(shot.x - 1.5, shot.y - 7, 3, 14))
            .join('');
    const mine = path(true);
    const others = path(false);
    return [
        ...(others ? [custom(0, 0, [{ d: others, fill: OTHER_SHOT_COLOR }])] : []),
        ...(mine ? [custom(0, 0, [{ d: mine, fill: MY_SHOT_COLOR }])] : []),
    ];
}

const DEBRIS = 10;

function effectCursor(effect: Effect): CanvasCursorData {
    const progress = Math.min(1, effect.age / EFFECT_SECONDS[effect.kind]);
    const fade = 1 - progress;
    if (effect.kind === 'spark') {
        return custom(effect.x, effect.y, [
            { d: circlePath(0, 0, 3 + 5 * progress), fill: withAlpha('#ffffff', fade) },
        ]);
    }
    const scale = effect.kind === 'blast' ? 1.8 : 1;
    const debris = Array.from({ length: DEBRIS }, (_, i) => {
        const angle = (2 * Math.PI * i) / DEBRIS + (i % 2) * 0.3;
        const distance = (8 + (i % 2 === 0 ? 70 : 48) * progress) * scale;
        return circlePath(Math.cos(angle) * distance, Math.sin(angle) * distance, (2.5 * fade + 0.5) * scale);
    }).join('');
    return custom(
        effect.x,
        effect.y,
        [
            { d: circlePath(0, 0, (4 + 14 * fade) * scale), fill: withAlpha('#ffffff', 0.85 * fade * fade) },
            { d: debris, fill: withAlpha(effect.color, fade) },
        ],
        [
            {
                d: circlePath(0, 0, (10 + 50 * progress) * scale),
                stroke: withAlpha(effect.color, fade),
                lineWidth: 1 + 3 * fade,
            },
        ],
    );
}

/** 奥ほど小さく遅く流れる星。時刻だけで決まるので、どの画面でも同じ流れ方になる。 */
const STAR_LAYERS = [
    { count: 36, speed: 14, size: 1, alpha: 0.3 },
    { count: 20, speed: 34, size: 1.5, alpha: 0.5 },
    { count: 8, speed: 70, size: 2, alpha: 0.75 },
] as const;

function starCursors(area: Rect, clock: number): CanvasCursorData[] {
    return STAR_LAYERS.map((layer, depth) => {
        const d = Array.from({ length: layer.count }, (_, i) => {
            const x = area.x + hash01(depth, i, 0) * area.w;
            const y = area.y + ((hash01(depth, i, 1) * area.h + clock * layer.speed) % area.h);
            return rectPath(x, y, layer.size, layer.size * 2);
        }).join('');
        return custom(0, 0, [{ d, fill: `rgba(191, 219, 254, ${layer.alpha})` }]);
    });
}

function frameCursor(area: Rect): CanvasCursorData {
    return custom(
        area.x,
        area.y,
        [],
        [{ d: rectPath(1, 1, area.w - 2, area.h - 2), stroke: FRAME_COLOR, lineWidth: 2 }],
    );
}

export function sceneCursors(scene: Scene): CanvasCursorData[] {
    const hitbox = scene.hitbox;
    return [
        ...starCursors(scene.area, scene.clock),
        frameCursor(scene.area),
        ...shotCursors(scene.shots),
        ...scene.enemies.flatMap((view) => enemyCursors(view, scene.clock)),
        ...scene.effects.map(effectCursor),
        ...bulletCursors(scene.bullets),
        ...(hitbox
            ? [
                  custom(
                      hitbox.center.x,
                      hitbox.center.y,
                      [{ d: circlePath(0, 0, hitbox.radius + 1), fill: '#ffffff' }],
                      [{ d: circlePath(0, 0, hitbox.radius + 2.5), stroke: '#f43f5e', lineWidth: 1.5 }],
                  ),
              ]
            : []),
    ];
}

export function ageEffects(effects: readonly Effect[], seconds: number): Effect[] {
    const dt = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, 0.1));
    return effects
        .map((effect) => ({ ...effect, age: effect.age + dt }))
        .filter((effect) => effect.age < EFFECT_SECONDS[effect.kind]);
}

/** 当たった場所に火花、倒れた敵の場所に輪を出す。 */
export function impactEffects(
    impacts: readonly Vec[],
    defeated: readonly { readonly spec: EnemySpec; readonly position: Vec }[],
): Effect[] {
    return [
        ...impacts.map((impact) => ({ kind: 'spark' as const, x: impact.x, y: impact.y, color: '#ffffff', age: 0 })),
        ...defeated.map(({ spec, position }) => ({
            kind: 'burst' as const,
            x: position.x,
            y: position.y,
            color: spec.color,
            age: 0,
        })),
    ];
}

const SHIP_HIT_COLOR = '#f43f5e';
const SHIP_RESPAWN_COLOR = '#7dd3fc';

/**
 * 自機の被弾・撃墜・復活の時刻が変わったら、その場所に演出を出す（同期された値なので、乗っていない人の画面にも出る）。
 * 初めて見た自機（後から部屋に入った等）の昔の被弾は出さない。
 */
export function shipEffects(before: ShipMarks | undefined, after: ShipMarks, at: Vec): Effect[] {
    if (!before) return [];
    const effect = (kind: EffectKind, color: string): Effect[] => [{ kind, x: at.x, y: at.y, color, age: 0 }];
    if (after.downAt > 0 && after.downAt !== before.downAt) return effect('blast', SHIP_HIT_COLOR);
    if (before.downAt > 0 && after.downAt === 0) return effect('burst', SHIP_RESPAWN_COLOR);
    if (after.hitAt > 0 && after.hitAt !== before.hitAt) return effect('burst', SHIP_HIT_COLOR);
    return [];
}
