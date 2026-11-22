import type { InitialEntity } from '@ubichill/shared';
import { type EntityPath, type FlatEntityNode, getEntityAt, isDescendantOrSelf } from './entityTree';

export interface StageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const samePath = (a: EntityPath | null, b: EntityPath | null): boolean =>
    !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** path を含む、いちばん外の置いたプレハブ（`prefab` を持つ Entity）。無ければ null。 */
export function outermostPrefabRoot(entities: InitialEntity[], path: EntityPath): EntityPath | null {
    const prefixes = path.map((_, i) => path.slice(0, i + 1));
    return prefixes.find((prefix) => !!getEntityAt(entities, prefix)?.prefab) ?? null;
}

/** プレハブの中の Entity を選んでいる（一式ではなく、中に入って編集している）か。 */
export const isInsidePrefab = (root: EntityPath, selected: EntityPath | null): boolean =>
    !!selected && selected.length > root.length && isDescendantOrSelf(selected, root);

/**
 * ワールドの上で Entity を押したとき、どれを選んで動かすか。置いたプレハブは一式（いちばん外の親）を選び、
 * 一式を選んでいるところでもう一度押して離せば、押した Entity に入る（`enterOnClick`。動かしたら入らない）。
 * 中に入った後は、同じプレハブの中の Entity をそのまま選ぶ。
 */
export function pressOnStage(
    entities: InitialEntity[],
    pressed: EntityPath,
    selected: EntityPath | null,
): { select: EntityPath; enterOnClick: EntityPath | null } {
    const root = outermostPrefabRoot(entities, pressed);
    if (!root || isInsidePrefab(root, selected)) return { select: pressed, enterOnClick: null };
    const enter = samePath(selected, root) && !samePath(pressed, root) ? pressed : null;
    return { select: root, enterOnClick: enter };
}

/** path とその子孫のうち、大きさのある Entity が占める範囲（ワールド座標）。無ければ null。 */
export function groupBounds(nodes: readonly FlatEntityNode[], path: EntityPath): StageRect | null {
    const rects = nodes
        .filter((n) => isDescendantOrSelf(n.path, path))
        .filter((n) => (n.entity.transform.w ?? 0) > 0 && (n.entity.transform.h ?? 0) > 0)
        .map((n) => ({
            left: n.absX,
            top: n.absY,
            right: n.absX + (n.entity.transform.w ?? 0),
            bottom: n.absY + (n.entity.transform.h ?? 0),
        }));
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    return {
        x: left,
        y: top,
        width: Math.max(...rects.map((r) => r.right)) - left,
        height: Math.max(...rects.map((r) => r.bottom)) - top,
    };
}

/** 矢印キーで選んだ Entity を動かす量（Shift で 10px）。矢印でなければ null。 */
export function nudgeFor(key: string, shift: boolean): { dx: number; dy: number } | null {
    const step = shift ? 10 : 1;
    if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
    if (key === 'ArrowRight') return { dx: step, dy: 0 };
    if (key === 'ArrowUp') return { dx: 0, dy: -step };
    if (key === 'ArrowDown') return { dx: 0, dy: step };
    return null;
}

/** Entity の見分けに出す名前（表示名が無ければ id）。 */
export const entityLabel = (entity: Pick<InitialEntity, 'id' | 'name'>): string => entity.name?.trim() || entity.id;
