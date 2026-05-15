import type { InitialEntity } from '@ubichill/shared';

/** ルートからの index 列で Entity を指す path 型。例: [0] / [0, 2] */
export type EntityPath = number[];

export function getEntityAt(entities: InitialEntity[], path: EntityPath): InitialEntity | null {
    if (path.length === 0) return null;
    const [head, ...rest] = path;
    const node = entities[head];
    if (!node) return null;
    if (rest.length === 0) return node;
    return getEntityAt(node.children ?? [], rest);
}

export function updateEntityAt(
    entities: InitialEntity[],
    path: EntityPath,
    updater: (e: InitialEntity) => InitialEntity,
): InitialEntity[] {
    if (path.length === 0) return entities;
    const [head, ...rest] = path;
    return entities.map((e, i) => {
        if (i !== head) return e;
        if (rest.length === 0) return updater(e);
        return { ...e, children: updateEntityAt(e.children ?? [], rest, updater) };
    });
}

export function deleteEntityAt(entities: InitialEntity[], path: EntityPath): InitialEntity[] {
    if (path.length === 0) return entities;
    const [head, ...rest] = path;
    if (rest.length === 0) return entities.filter((_, i) => i !== head);
    return entities.map((e, i) => (i === head ? { ...e, children: deleteEntityAt(e.children ?? [], rest) } : e));
}

/** parentPath が null ならルート末尾に追加。指定があればその子の末尾に追加する。 */
export function insertEntity(
    entities: InitialEntity[],
    parentPath: EntityPath | null,
    newEntity: InitialEntity,
): InitialEntity[] {
    if (!parentPath) return [...entities, newEntity];
    return updateEntityAt(entities, parentPath, (p) => ({ ...p, children: [...(p.children ?? []), newEntity] }));
}

/** path 中で `oldIndex` 番目の Entity が削除されたとき、削除後の path を返す (関連しないなら null)。 */
export function adjustPathAfterDelete(targetPath: EntityPath | null, deletedPath: EntityPath): EntityPath | null {
    if (!targetPath) return null;
    // 削除 path が target の祖先 or 同一なら null
    if (deletedPath.length <= targetPath.length) {
        const ancestor = targetPath.slice(0, deletedPath.length - 1);
        const head = deletedPath.slice(0, -1);
        if (ancestor.every((v, i) => v === head[i])) {
            const lastDeleted = deletedPath[deletedPath.length - 1];
            const targetAtSameLevel = targetPath[deletedPath.length - 1];
            if (targetAtSameLevel === lastDeleted) return null;
            if (targetAtSameLevel > lastDeleted) {
                return [
                    ...targetPath.slice(0, deletedPath.length - 1),
                    targetAtSameLevel - 1,
                    ...targetPath.slice(deletedPath.length),
                ];
            }
        }
    }
    return targetPath;
}

/** ルート Entity の最大 z 値 + 1。 */
export function nextRootZ(entities: InitialEntity[]): number {
    return entities.reduce((m, e) => Math.max(m, e.transform.z ?? 0), 0) + 1;
}

/** kebab-case 衝突を避けて新 entity id を採番する。 */
export function buildUniqueEntityId(seed: string, taken: Iterable<string>): string {
    const base = seed.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'entity';
    const used = new Set<string>(taken);
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
}

/** ツリー内の全 entity id を再帰収集する。 */
export function collectEntityIds(entities: InitialEntity[]): string[] {
    const out: string[] = [];
    const walk = (es: InitialEntity[]) => {
        for (const e of es) {
            out.push(e.id);
            if (e.children?.length) walk(e.children);
        }
    };
    walk(entities);
    return out;
}
