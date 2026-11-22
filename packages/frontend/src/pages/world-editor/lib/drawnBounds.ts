import {
    absoluteEntityTransform,
    componentTransformOf,
    type EntityComponentDef,
    type EntityTransform,
    resolveOverlayMode,
} from '@ubichill/shared';
import type { FlatEntityNode } from './entityTree';

export interface StageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** rects をすべて囲む矩形。無ければ null。 */
export function enclosing(rects: readonly StageRect[]): StageRect | null {
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    return {
        x: left,
        y: top,
        width: Math.max(...rects.map((r) => r.x + r.width)) - left,
        height: Math.max(...rects.map((r) => r.y + r.height)) - top,
    };
}

/** 長さ size の範囲の始まりを、0〜limit に収まるように寄せる。入りきらなければ始まりを 0 にそろえる。 */
export const keepInside = (start: number, size: number, limit: number): number =>
    Math.min(Math.max(start, 0), Math.max(0, limit - size));

/**
 * 描く側（surfacePlacement・EntityRenderer）と同じく、w×h を左上を軸に拡大・回転したものを囲む矩形。
 * w・h のどちらかが 0 なら大きさは中身次第で決まらないので null。
 */
export function drawnBox(t: EntityTransform): StageRect | null {
    if (t.w <= 0 || t.h <= 0) return null;
    const rad = (t.rotation * Math.PI) / 180;
    const corners: [number, number][] = [
        [0, 0],
        [t.w, 0],
        [0, t.h],
        [t.w, t.h],
    ];
    return enclosing(
        corners.map(([u, v]) => ({
            x: t.x + t.scale * (u * Math.cos(rad) - v * Math.sin(rad)),
            y: t.y + t.scale * (u * Math.sin(rad) + v * Math.cos(rad)),
            width: 0,
            height: 0,
        })),
    );
}

// 画面固定の Component と、x・y を上書きした Component（絶対位置）は Entity を動かしても付いてこない
const followsEntity = (c: EntityComponentDef): boolean =>
    resolveOverlayMode(c.overlay) === null && c.transform?.x === undefined && c.transform?.y === undefined;

/**
 * Entity と一緒に動いて描かれる範囲（ワールド座標）。大きさは描く側と同じく Component ごとの transform の上書きを当てて決める。
 * Component が無ければ Entity 自身の大きさ（エディタが枠を出す）。
 */
export function drawnBoxesOf(node: Pick<FlatEntityNode, 'entity' | 'absX' | 'absY'>): StageRect[] {
    const at = { ...absoluteEntityTransform(node.entity.transform, { x: 0, y: 0, z: 0 }), x: node.absX, y: node.absY };
    const components = node.entity.components;
    const overrides = components.length === 0 ? [undefined] : components.filter(followsEntity).map((c) => c.transform);
    return overrides.flatMap((override) => drawnBox(componentTransformOf(at, override)) ?? []);
}
