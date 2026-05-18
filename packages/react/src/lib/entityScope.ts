import type { ComponentInstance } from '@ubichill/shared';

export type WatchScope = 'entity' | 'subtree' | 'world';

/**
 * `entities` 全体から「`rootGameObjectId` 自身 + その子孫の entityId 集合」を求める純関数。
 * parentEntityId のチェーンを遡って祖先に rootGameObjectId が含まれるかで判定する。
 */
export function collectSubtreeGameObjectIds(
    entities: Iterable<ComponentInstance>,
    rootGameObjectId: string,
): Set<string> {
    // entityId → parentEntityId のマップを構築
    const parentOf = new Map<string, string | undefined>();
    for (const e of entities) {
        if (e.entityId && !parentOf.has(e.entityId)) {
            parentOf.set(e.entityId, e.parentEntityId);
        }
    }
    // 子孫: parent チェーンを遡ったとき root に到達する entityId を集める
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
 * Worker から見える ComponentInstance を判定する純関数。
 */
export function isVisibleInScope(
    e: ComponentInstance,
    scope: WatchScope,
    rootGameObjectId: string | undefined,
    subtreeIds: Set<string> | null,
): boolean {
    if (scope === 'world' || !rootGameObjectId) return true;
    if (scope === 'entity') return e.entityId === rootGameObjectId;
    // subtree
    return !!e.entityId && (subtreeIds?.has(e.entityId) ?? false);
}
