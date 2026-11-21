import { CORE_COMPONENT_TYPES } from '@ubichill/core-components';
import type { ComponentInstance, CursorPosition } from '@ubichill/shared';

type Placed = Pick<ComponentInstance, 'type' | 'entityId' | 'transform'>;

function centerOf(transform: ComponentInstance['transform']): CursorPosition {
    return { x: transform.x + transform.w / 2, y: transform.y + transform.h / 2 };
}

/** Entity（GameObject）の中心。Component の transform の上書きは使わず、最初の Component の置き場所で決める。 */
export function entityCenter(entities: Iterable<Placed>, entityId: string): CursorPosition | null {
    for (const entity of entities) if (entity.entityId === entityId) return centerOf(entity.transform);
    return null;
}

/**
 * 部屋に入ったときに画面の中心に置く場所（`core:spawn` の中心）。複数あれば pick で 1 つ選ぶ。見えない Entity の印は使わない。
 * @param pick 0 以上 1 未満（Math.random）
 */
export function spawnCenter(
    entities: Iterable<Placed>,
    hidden: ReadonlySet<string>,
    pick: () => number,
): CursorPosition | null {
    const spawns = [...entities].filter(
        (entity) => entity.type === CORE_COMPONENT_TYPES.spawn && !(entity.entityId && hidden.has(entity.entityId)),
    );
    const chosen = spawns[Math.min(spawns.length - 1, Math.floor(pick() * spawns.length))];
    return chosen ? centerOf(chosen.transform) : null;
}
