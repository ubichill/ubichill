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

/**
 * 既存の entity (siblingPath) の直後に新 entity を挿入する。
 * 複製操作 (Cmd+D) で「自分のすぐ下に出現」する自然な挙動を実現するため。
 */
export function insertEntityAfter(
    entities: InitialEntity[],
    siblingPath: EntityPath,
    newEntity: InitialEntity,
): InitialEntity[] {
    if (siblingPath.length === 0) return [...entities, newEntity];
    if (siblingPath.length === 1) {
        const idx = siblingPath[0];
        return [...entities.slice(0, idx + 1), newEntity, ...entities.slice(idx + 1)];
    }
    const parentPath = siblingPath.slice(0, -1);
    const idx = siblingPath[siblingPath.length - 1];
    return updateEntityAt(entities, parentPath, (p) => {
        const kids = p.children ?? [];
        return { ...p, children: [...kids.slice(0, idx + 1), newEntity, ...kids.slice(idx + 1)] };
    });
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

/**
 * 名前 (entity id) の重複時に末尾の数字をインクリメントする。
 *   "hoge"     + ["hoge"]         → "hoge2"
 *   "hoge2"    + ["hoge2"]        → "hoge3"
 *   "foo-bar"  + ["foo-bar"]      → "foo-bar2"
 *   "hoge"     + ["hoge","hoge2"] → "hoge3"
 *
 * `buildUniqueEntityId` (`hoge-2` 形式) は plugin から spawn される ECS Entity
 * 識別子向けで kebab を強制するため、ユーザー rename 用とは別。
 */
export function ensureUniqueName(desired: string, taken: Iterable<string>): string {
    const used = new Set<string>(taken);
    if (!used.has(desired)) return desired;
    const m = desired.match(/^(.+?)(\d+)$/);
    const base = m ? m[1] : desired;
    let n = m ? Number(m[2]) + 1 : 2;
    while (used.has(`${base}${n}`)) n += 1;
    return `${base}${n}`;
}

/**
 * Entity subtree をディープコピーし、自分と子孫全ての id を `taken` と衝突しないよう採番する。
 * children を含む全 entity が新 id を持つ (= 永続化したときに id 競合しない)。
 *
 * 採番は `${base}-copy` を seed にして `buildUniqueEntityId` で kebab-uniqueness を取る。
 * これで「再帰」中の中間 id も taken に積み増しながら一意性を保証する。
 */
export function cloneEntitySubtree(entity: InitialEntity, taken: Iterable<string>): InitialEntity {
    const used = new Set<string>(taken);
    const cloneRecursive = (e: InitialEntity): InitialEntity => {
        const newId = buildUniqueEntityId(`${e.id}-copy`, used);
        used.add(newId);
        return {
            id: newId,
            transform: { ...e.transform },
            components: e.components.map((c) => ({
                type: c.type,
                data: structuredClone(c.data) as Record<string, unknown>,
            })),
            tags: [...e.tags],
            children: (e.children ?? []).map(cloneRecursive),
        };
    };
    return cloneRecursive(entity);
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

export const pathKey = (p: EntityPath): string => p.join('-');

/** path とその全祖先 path のキーを返す。子の非表示判定に使う。 */
export function pathAndAncestorKeys(path: EntityPath): string[] {
    const out: string[] = [];
    for (let i = 1; i <= path.length; i += 1) out.push(pathKey(path.slice(0, i)));
    return out;
}

/** path が target または target の子孫であるか。 */
export function isDescendantOrSelf(path: EntityPath, target: EntityPath): boolean {
    if (path.length < target.length) return false;
    return target.every((v, i) => v === path[i]);
}

/** Entity を path から取り外し、newParentPath の末尾子として挿入。null なら root 末尾。 */
export function moveEntity(entities: InitialEntity[], from: EntityPath, to: EntityPath | null): InitialEntity[] {
    if (from.length === 0) return entities;
    if (to && isDescendantOrSelf(to, from)) return entities; // 自分の子孫には移動できない
    const node = getEntityAt(entities, from);
    if (!node) return entities;
    const removed = deleteEntityAt(entities, from);
    // from 削除によって to が指す位置が変わる可能性 → from の祖先・兄弟ケースを補正
    const adjustedTo = adjustPathAfterRemove(to, from);
    return insertEntity(removed, adjustedTo, node);
}

/** Stage 用 flat 表示エントリ: path + 絶対座標 + Entity 参照。 */
export interface FlatEntityNode {
    path: EntityPath;
    entity: InitialEntity;
    /** 親 origin を加算した絶対座標 */
    absX: number;
    absY: number;
    absZ: number;
}

/** ツリーを Stage 表示用に flatten する純関数。親基準の transform.x/y を絶対化する。 */
export function flattenForStage(entities: InitialEntity[]): FlatEntityNode[] {
    const out: FlatEntityNode[] = [];
    const walk = (entity: InitialEntity, path: EntityPath, origin: { x: number; y: number; z: number }) => {
        const t = entity.transform;
        const absX = origin.x + t.x;
        const absY = origin.y + t.y;
        const absZ = origin.z + (t.z ?? 0);
        out.push({ path, entity, absX, absY, absZ });
        entity.children?.forEach((child, ci) => {
            walk(child, [...path, ci], { x: absX, y: absY, z: absZ });
        });
    };
    entities.forEach((e, i) => {
        walk(e, [i], { x: 0, y: 0, z: 0 });
    });
    return out;
}

/** target path が from 削除後どう変わるかを計算する純関数。null なら影響なし。 */
function adjustPathAfterRemove(target: EntityPath | null, from: EntityPath): EntityPath | null {
    if (!target) return target;
    if (target.length < from.length) return target;
    const sameHead = from.slice(0, -1).every((v, i) => v === target[i]);
    if (!sameHead) return target;
    const sibIdx = from[from.length - 1];
    const targetAtLevel = target[from.length - 1];
    if (targetAtLevel < sibIdx) return target;
    if (targetAtLevel === sibIdx) return target; // target が from と同じ位置 (= from の子孫を移動先にできない、上で弾く)
    return [...target.slice(0, from.length - 1), targetAtLevel - 1, ...target.slice(from.length)];
}
