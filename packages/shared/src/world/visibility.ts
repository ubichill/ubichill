/**
 * 見える・見えない（`core:switch`）。インスタンスは見えない Entity（GameObject）の ID だけを持ち、子が見えないかは親を辿って決める。
 */

/** 親を辿るのに要る形（flat な ComponentInstance）。 */
export interface VisibilityNode {
    entityId?: string;
    parentEntityId?: string;
}

/** 見えない GameObject の ID（見えない親の子孫を含む）。 */
export function hiddenGameObjects(nodes: Iterable<VisibilityNode>, hidden: ReadonlySet<string>): Set<string> {
    const parentOf = new Map<string, string | undefined>();
    for (const node of nodes) if (node.entityId) parentOf.set(node.entityId, node.parentEntityId);
    const isHidden = (id: string, depth: number): boolean => {
        if (hidden.has(id)) return true;
        const parent = parentOf.get(id);
        // 親の輪（壊れた定義）でも止まるよう、深さを GameObject の数で打ち切る
        return parent !== undefined && depth < parentOf.size && isHidden(parent, depth + 1);
    };
    return new Set([...parentOf.keys()].filter((id) => isHidden(id, 0)));
}
