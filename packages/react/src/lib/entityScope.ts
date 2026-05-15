import type { WorldEntity } from '@ubichill/shared';

export type WatchScope = 'entity' | 'subtree' | 'world';

/**
 * `entities` 全体から「`rootGameObjectId` 自身 + その子孫の gameObjectId 集合」を求める純関数。
 * parentGameObjectId のチェーンを遡って祖先に rootGameObjectId が含まれるかで判定する。
 */
export function collectSubtreeGameObjectIds(entities: Iterable<WorldEntity>, rootGameObjectId: string): Set<string> {
    // gameObjectId → parentGameObjectId のマップを構築
    const parentOf = new Map<string, string | undefined>();
    for (const e of entities) {
        if (e.gameObjectId && !parentOf.has(e.gameObjectId)) {
            parentOf.set(e.gameObjectId, e.parentGameObjectId);
        }
    }
    // 子孫: parent チェーンを遡ったとき root に到達する gameObjectId を集める
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
 * Worker から見える WorldEntity を判定する純関数。
 */
export function isVisibleInScope(
    e: WorldEntity,
    scope: WatchScope,
    rootGameObjectId: string | undefined,
    subtreeIds: Set<string> | null,
): boolean {
    if (scope === 'world' || !rootGameObjectId) return true;
    if (scope === 'entity') return e.gameObjectId === rootGameObjectId;
    // subtree
    return !!e.gameObjectId && (subtreeIds?.has(e.gameObjectId) ?? false);
}
