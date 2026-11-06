import {
    type DataFieldsLike,
    describeReferenceProblem,
    fieldLabel,
    findReferenceProblems,
    type InitialEntity,
    type ReferenceProblem,
} from '@ubichill/shared';
import type { AvailableEntityKind } from '../hooks/useAvailableEntityKinds';

/** Component 型 → その dataFields。mod の取得前（kinds に無い型）は undefined。 */
export type FieldsOf = (componentType: string) => DataFieldsLike | undefined;

export function fieldsOfKinds(kinds: readonly AvailableEntityKind[]): FieldsOf {
    const fieldsByType = new Map(kinds.map((kind) => [kind.kind, kind.dataFields]));
    return (type) => fieldsByType.get(type);
}

/** ワールドの参照の問題を、作者に見せる説明付きで挙げる。mod の取得前（kinds に無い型）は検査しない。 */
export function editorReferenceProblems(
    entities: readonly InitialEntity[],
    kinds: readonly AvailableEntityKind[],
): Array<ReferenceProblem & { message: string }> {
    const fieldsOf = fieldsOfKinds(kinds);
    return findReferenceProblems(entities, fieldsOf).map((problem) => ({
        ...problem,
        message: describeReferenceProblem(problem, fieldLabel(fieldsOf(problem.componentType), problem.field)),
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
