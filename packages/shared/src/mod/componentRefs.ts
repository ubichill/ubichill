/**
 * Component の参照フィールド（`entityRef` / `entityRefArray`）の解決と検査。
 *
 * 参照はワールド作者の配線。mod は「どの型の Component を指してほしいか」（`component`）だけを宣言し、
 * 実際にどの Entity を指すかは作者が Inspector で決める。Host は配線された相手にだけ届けるので、
 * mod が階層の形を作者に暗黙に要求しなくて済む（#191）。
 *
 * World Editor・`ubichill dev`・Host の配送が同じ判定を使う。zod には依存しない。
 */

/** 参照フィールドの宣言のうち、解決と検査に使う部分。 */
export interface RefFieldSpec {
    type: string;
    /** 参照先の Entity が持つべき Component 型（`modId:componentName`）。 */
    component?: string;
    /** 未設定をワールドの問題として扱う。 */
    required?: boolean;
}

/** 1 つの参照フィールドを解決した結果。 */
export interface ResolvedRef {
    field: string;
    entityIds: readonly string[];
    component?: string;
}

export function isRefField(spec: RefFieldSpec): boolean {
    return spec.type === 'entityRef' || spec.type === 'entityRefArray';
}

/** フィールドの値を参照先の entityId の列にする。型の合わない値・空文字は無視する。 */
export function refTargets(spec: RefFieldSpec, value: unknown): string[] {
    const values = spec.type === 'entityRef' ? [value] : Array.isArray(value) ? value : [];
    return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/** Component の data から、参照フィールドをすべて解決する。 */
export function resolveRefs(
    dataFields: Readonly<Record<string, RefFieldSpec>> | undefined,
    data: Readonly<Record<string, unknown>>,
): ResolvedRef[] {
    return Object.entries(dataFields ?? {})
        .filter(([, spec]) => isRefField(spec))
        .map(([field, spec]) => ({
            field,
            entityIds: refTargets(spec, data[field]),
            ...(spec.component ? { component: spec.component } : {}),
        }));
}

/** 検査の対象になる Entity の形（ワールド定義の `initialEntities` と同じ形）。 */
export interface RefCheckEntity {
    id: string;
    components: readonly { id?: string; type: string; data?: Readonly<Record<string, unknown>> }[];
    children: readonly RefCheckEntity[];
}

interface ProblemLocation {
    /** 参照フィールドを持つ Component が載っている Entity。 */
    entityId: string;
    componentType: string;
    /** Entity の `components` の中の位置。 */
    componentIndex: number;
    field: string;
}

export type ReferenceProblem = ProblemLocation &
    (
        | { kind: 'missing'; component?: string }
        | { kind: 'not-found'; target: string }
        | { kind: 'wrong-type'; target: string; component: string }
    );

function flattenEntities(entities: readonly RefCheckEntity[]): RefCheckEntity[] {
    return entities.flatMap((entity) => [entity, ...flattenEntities(entity.children)]);
}

/**
 * ワールドの参照の問題を挙げる。`fieldsOf` が型を知らない Component（mod が未取得など）は検査しない。
 * - missing: `required` の参照が空
 * - not-found: 指している Entity がワールドに無い
 * - wrong-type: 指している Entity に `component` の型の Component が無い
 */
export function findReferenceProblems(
    entities: readonly RefCheckEntity[],
    fieldsOf: (componentType: string) => Readonly<Record<string, RefFieldSpec>> | undefined,
): ReferenceProblem[] {
    const all = flattenEntities(entities);
    const typesOf = new Map(all.map((entity) => [entity.id, new Set(entity.components.map((c) => c.type))]));

    return all.flatMap((entity) =>
        entity.components.flatMap((component, componentIndex) =>
            Object.entries(fieldsOf(component.type) ?? {})
                .filter(([, spec]) => isRefField(spec))
                .flatMap(([field, spec]): ReferenceProblem[] => {
                    const at = { entityId: entity.id, componentType: component.type, componentIndex, field };
                    const targets = refTargets(spec, component.data?.[field]);
                    if (targets.length === 0) {
                        return spec.required ? [{ ...at, kind: 'missing', component: spec.component }] : [];
                    }
                    return targets.flatMap((target): ReferenceProblem[] => {
                        const types = typesOf.get(target);
                        if (!types) return [{ ...at, kind: 'not-found', target }];
                        if (spec.component && !types.has(spec.component)) {
                            return [{ ...at, kind: 'wrong-type', target, component: spec.component }];
                        }
                        return [];
                    });
                }),
        ),
    );
}

/** 作者に見せる説明。`label` はフィールドの表示名（無ければフィールド名）。 */
export function describeReferenceProblem(problem: ReferenceProblem, label: string = problem.field): string {
    const where = `${problem.entityId} の ${problem.componentType} の「${label}」`;
    switch (problem.kind) {
        case 'missing':
            return problem.component
                ? `${where}が未設定です。${problem.component} を持つ Entity を指定してください`
                : `${where}が未設定です`;
        case 'not-found':
            return `${where}が指している Entity「${problem.target}」がありません`;
        case 'wrong-type':
            return `${where}が指している「${problem.target}」に ${problem.component} がありません`;
    }
}
