import {
    describeReferenceProblem,
    findReferenceProblems,
    type InitialEntity,
    type ReferenceProblem,
    type RefFieldSpec,
} from '@ubichill/shared';
import type { AvailableEntityKind, DataFields } from '../hooks/useAvailableEntityKinds';

const labelOf = (fields: DataFields | undefined, field: string): string => fields?.[field]?.label ?? field;

/** ワールドの参照の問題を、作者に見せる説明付きで挙げる。mod の取得前（kinds に無い型）は検査しない。 */
export function editorReferenceProblems(
    entities: readonly InitialEntity[],
    kinds: readonly AvailableEntityKind[],
): Array<ReferenceProblem & { message: string }> {
    const fieldsByType = new Map(kinds.map((kind) => [kind.kind, kind.dataFields]));
    return findReferenceProblems(
        entities,
        (type) => fieldsByType.get(type) as Readonly<Record<string, RefFieldSpec>> | undefined,
    ).map((problem) => ({
        ...problem,
        message: describeReferenceProblem(problem, labelOf(fieldsByType.get(problem.componentType), problem.field)),
    }));
}

/** entityId → その Entity の Component が持つ参照の問題の説明（Hierarchy の印に使う）。 */
export function problemsByEntity(
    problems: ReadonlyArray<{ entityId: string; message: string }>,
): ReadonlyMap<string, readonly string[]> {
    return problems.reduce(
        (map, { entityId, message }) => map.set(entityId, [...(map.get(entityId) ?? []), message]),
        new Map<string, string[]>(),
    );
}

function findEntity(entities: readonly InitialEntity[], id: string): InitialEntity | undefined {
    return entities.reduce<InitialEntity | undefined>(
        (found, entity) => found ?? (entity.id === id ? entity : findEntity(entity.children, id)),
        undefined,
    );
}

/** 参照フィールドの 1 つの値の問題。問題が無ければ null。 */
export function refTargetError(
    entities: readonly InitialEntity[],
    target: string,
    component: string | undefined,
): string | null {
    const entity = findEntity(entities, target);
    if (!entity) return `Entity「${target}」がありません`;
    if (component && !entity.components.some((c) => c.type === component)) {
        return `「${target}」に ${component} がありません`;
    }
    return null;
}
