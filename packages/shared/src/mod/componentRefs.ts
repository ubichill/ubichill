/**
 * Component の参照フィールド（`entityRef` / `entityRefArray`）の解決と検査。
 *
 * 参照はワールド作者の配線。mod は「どの型の Component を指してほしいか」（`component`）だけを宣言し、
 * 実際にどの Entity を指すかは作者が Inspector で決める。Host は配線された相手にだけ届けるので、
 * mod が階層の形を作者に暗黙に要求しなくて済む（#191）。
 *
 * World Editor・`ubichill dev`・Host の配送が同じ判定を使う。zod には依存しない。
 */
import { CORE_COMPONENT_TYPES } from '@ubichill/core-components/public';

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
        /** 1 つの動画面に、ほかの出力（Component のインスタンス × 参照フィールド）も向いている。 */
        | { kind: 'media-shared'; target: string; others: number }
        /** 1 つの Entity に core:media が 2 つ以上ある（field は空）。 */
        | { kind: 'media-duplicate' }
    );

/** 競合の判定に使う Component のインスタンス。`key` はインスタンスごとに一意（Host は flat id）。 */
export interface RefComponentRecord {
    key: string;
    entityId: string;
    type: string;
    data?: Readonly<Record<string, unknown>>;
}

/** 動画面への出力 1 つ（Component のインスタンス × core:media を指す参照フィールド）。 */
export interface MediaOutput {
    key: string;
    entityId: string;
    componentType: string;
    field: string;
}

export interface MediaConflicts {
    /** core:media を 2 つ以上持つ Entity。 */
    duplicatedSurfaces: ReadonlySet<string>;
    /** 2 つ以上の出力が向いている動画面 → 向いている出力。 */
    sharedSurfaces: ReadonlyMap<string, readonly MediaOutput[]>;
}

/**
 * 動画面の競合を挙げる。1 つの動画面（core:media の Entity）に出力できるのは、Component のインスタンス × 参照フィールドの
 * 1 つだけ。同じ mod の Component が 2 つあっても競合する。競合した面には誰の動画も描かない（読み込みの順で勝ち負けを
 * 決めると、ブラウザごとに結果が変わるため）。複数の操作パネルを置くときは、再生を担当する Component を 1 つ決め、
 * ほかのパネルからは参照で指示を送る。
 */
export function findMediaConflicts(
    components: readonly RefComponentRecord[],
    fieldsOf: (componentType: string) => Readonly<Record<string, RefFieldSpec>> | undefined,
): MediaConflicts {
    const surfaces = components.filter((c) => c.type === CORE_COMPONENT_TYPES.media).map((c) => c.entityId);
    const surfaceSet = new Set(surfaces);
    const duplicatedSurfaces = new Set(surfaces.filter((id, i) => surfaces.indexOf(id) !== i));
    const outputs = components.flatMap((c) =>
        Object.entries(fieldsOf(c.type) ?? {})
            .filter(([, spec]) => isRefField(spec) && spec.component === CORE_COMPONENT_TYPES.media)
            .flatMap(([field, spec]) =>
                refTargets(spec, c.data?.[field])
                    .filter((target) => surfaceSet.has(target))
                    .map((target) => ({
                        target,
                        output: { key: c.key, entityId: c.entityId, componentType: c.type, field },
                    })),
            ),
    );
    const byTarget = outputs.reduce(
        (map, { target, output }) => map.set(target, [...(map.get(target) ?? []), output]),
        new Map<string, MediaOutput[]>(),
    );
    return {
        duplicatedSurfaces,
        sharedSurfaces: new Map([...byTarget].filter(([, list]) => list.length > 1)),
    };
}

/** 競合していて動画を描かない動画面の Entity。 */
export function conflictedMediaSurfaces(conflicts: MediaConflicts): ReadonlySet<string> {
    return new Set([...conflicts.duplicatedSurfaces, ...conflicts.sharedSurfaces.keys()]);
}

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
    const keyOf = (entityId: string, index: number): string => `${entityId}#${index}`;
    const records = all.flatMap((entity) =>
        entity.components.map((c, index) => ({
            key: keyOf(entity.id, index),
            entityId: entity.id,
            type: c.type,
            data: c.data,
        })),
    );
    const media = findMediaConflicts(records, fieldsOf);
    const indexOf = (key: string): number => Number(key.slice(key.lastIndexOf('#') + 1));

    // 重複は Entity ごとに 1 件（2 つ目の core:media の位置で報告する）
    const duplicates = [...media.duplicatedSurfaces].map(
        (entityId): ReferenceProblem => ({
            entityId,
            componentType: CORE_COMPONENT_TYPES.media,
            componentIndex: indexOf(
                records.filter((r) => r.entityId === entityId && r.type === CORE_COMPONENT_TYPES.media)[1]?.key ?? '#0',
            ),
            field: '',
            kind: 'media-duplicate',
        }),
    );
    const shared = [...media.sharedSurfaces]
        .filter(([target]) => !media.duplicatedSurfaces.has(target))
        .flatMap(([target, list]) =>
            list.map(
                (output): ReferenceProblem => ({
                    entityId: output.entityId,
                    componentType: output.componentType,
                    componentIndex: indexOf(output.key),
                    field: output.field,
                    kind: 'media-shared',
                    target,
                    others: list.length - 1,
                }),
            ),
        );

    const fieldProblems = all.flatMap((entity) =>
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
    return [...fieldProblems, ...duplicates, ...shared];
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
        case 'media-shared':
            return `${where}が指している動画面「${problem.target}」には、ほかに ${problem.others} 個の出力が向いているため、動画を描きません。動画面ごとに再生を担当する Component を 1 つに決め、ほかのパネルからは参照で指示を送ってください`;
        case 'media-duplicate':
            return `${problem.entityId} に core:media が 2 つ以上あるため、動画を描きません。1 つにしてください`;
    }
}
