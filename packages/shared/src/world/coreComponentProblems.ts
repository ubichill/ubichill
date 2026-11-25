import { isCoreComponentNamespace, isCoreComponentType, unknownCoreComponentKeys } from '@ubichill/core-components';

/**
 * この版の ubichill が知らない本体の部品・項目。読む側は残して使わないので、書く側（エディタ・CLI）が作者に知らせる。
 * 新しい ubichill で作られたワールドか、書き間違い。
 */
export type CoreComponentProblem =
    | { entityId: string; componentType: string; kind: 'unknown-type' }
    | { entityId: string; componentType: string; kind: 'unknown-keys'; keys: string[] };

/** 調べるのに要る Entity の形（ワールドの Entity も、CLI が読んだままのものも渡せる）。 */
export interface CoreCheckEntity {
    id: string;
    components: readonly { type: string; data?: unknown }[];
    children: readonly CoreCheckEntity[];
}

export function findCoreComponentProblems(entities: readonly CoreCheckEntity[]): CoreComponentProblem[] {
    return entities.flatMap((entity) => [
        ...entity.components.flatMap((component): CoreComponentProblem[] => {
            if (!isCoreComponentNamespace(component.type)) return [];
            const base = { entityId: entity.id, componentType: component.type };
            if (!isCoreComponentType(component.type)) return [{ ...base, kind: 'unknown-type' }];
            const keys = unknownCoreComponentKeys(component.type, component.data ?? {});
            return keys.length > 0 ? [{ ...base, kind: 'unknown-keys', keys }] : [];
        }),
        ...findCoreComponentProblems(entity.children),
    ]);
}

export function describeCoreComponentProblem(problem: CoreComponentProblem): string {
    return problem.kind === 'unknown-type'
        ? `${problem.componentType} はこの ubichill に無い部品です。インスタンスでは使われません（新しい ubichill で作られたか、書き間違い）`
        : `${problem.componentType} の ${problem.keys.join('・')} はこの ubichill に無い項目です。インスタンスでは使われません`;
}

/** 部屋に知らせる、この版が知らない本体の部品の型（重ならない）。 */
export function unknownCoreComponentTypes(types: Iterable<string>): string[] {
    return [...new Set([...types].filter((type) => isCoreComponentNamespace(type) && !isCoreComponentType(type)))];
}

export function unknownCoreComponentsMessage(types: readonly string[]): string {
    return `このワールドには、このサーバーの ubichill に無い部品（${types.join('・')}）があり、その部分は表示されません。`;
}
