import type { ComponentInstance } from '@ubichill/shared';

export type WatchScope = 'entity' | 'subtree' | 'parent' | 'world';

/** entityId → parentEntityId のマップを純関数で構築する。 */
function buildParentOfMap(entities: Iterable<ComponentInstance>): Map<string, string | undefined> {
    const parentOf = new Map<string, string | undefined>();
    for (const e of entities) {
        if (e.entityId && !parentOf.has(e.entityId)) {
            parentOf.set(e.entityId, e.parentEntityId);
        }
    }
    return parentOf;
}

/**
 * `entities` 全体から「`rootGameObjectId` 自身 + その子孫の entityId 集合」を求める純関数。
 * parentEntityId のチェーンを遡って祖先に rootGameObjectId が含まれるかで判定する。
 */
export function collectSubtreeGameObjectIds(
    entities: Iterable<ComponentInstance>,
    rootGameObjectId: string,
): Set<string> {
    const parentOf = buildParentOfMap(entities);
    const subtree = new Set<string>([rootGameObjectId]);
    for (const gid of parentOf.keys()) {
        if (subtree.has(gid)) continue;
        const chain: string[] = [];
        let cur: string | undefined = gid;
        while (cur && !subtree.has(cur)) {
            chain.push(cur);
            cur = parentOf.get(cur);
        }
        if (cur && subtree.has(cur)) {
            for (const id of chain) subtree.add(id);
        }
    }
    return subtree;
}

/**
 * `selfGameObjectId` 自身 + parentEntityId をたどった祖先全ての entityId 集合を求める純関数。
 * 子から親の Component を watch する 'parent' スコープ用。
 */
export function collectAncestorGameObjectIds(
    entities: Iterable<ComponentInstance>,
    selfGameObjectId: string,
): Set<string> {
    const parentOf = buildParentOfMap(entities);
    const ancestors = new Set<string>([selfGameObjectId]);
    let cur: string | undefined = parentOf.get(selfGameObjectId);
    while (cur && !ancestors.has(cur)) {
        ancestors.add(cur);
        cur = parentOf.get(cur);
    }
    return ancestors;
}

/**
 * Worker から見える ComponentInstance を判定する純関数。
 *
 * scopedIds の意味はスコープによって異なる:
 *  - 'subtree' → 子孫を含む集合 (collectSubtreeGameObjectIds の結果)
 *  - 'parent'  → 祖先を含む集合 (collectAncestorGameObjectIds の結果)
 *  - その他    → 使われない
 */
export function isVisibleInScope(
    e: ComponentInstance,
    scope: WatchScope,
    rootGameObjectId: string | undefined,
    scopedIds: Set<string> | null,
): boolean {
    if (scope === 'world' || !rootGameObjectId) return true;
    if (scope === 'entity') return e.entityId === rootGameObjectId;
    return !!e.entityId && (scopedIds?.has(e.entityId) ?? false);
}
