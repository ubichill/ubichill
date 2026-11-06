/**
 * `ubichill dev` で、ワールドの参照フィールド（`entityRef` / `entityRefArray`）の問題を mod の開発者に知らせる。
 * 判定は World Editor・Host と同じ `@ubichill/shared` の関数を使う。
 */
import {
    describeReferenceProblem,
    findReferenceProblems,
    type RefCheckEntity,
    type RefFieldSpec,
} from '@ubichill/shared';
import type { ModArtifacts } from '../build.ts';

type FieldSpec = RefFieldSpec & { label?: string };
export type FieldsOf = (componentType: string) => Readonly<Record<string, FieldSpec>> | undefined;

/** 成果物の manifest.json から、Component 型ごとの dataFields を引けるようにする。 */
export function manifestFieldsOf(mods: Iterable<Pick<ModArtifacts, 'files'>>): FieldsOf {
    const decoder = new TextDecoder();
    const entries = [...mods].flatMap((mod) => {
        const bytes = mod.files.get('manifest.json');
        if (!bytes) return [];
        const manifest = JSON.parse(decoder.decode(bytes)) as {
            components?: Record<string, { dataFields?: Record<string, FieldSpec> }>;
        };
        return Object.entries(manifest.components ?? {}).map(([type, c]) => [type, c.dataFields] as const);
    });
    const byType = new Map(entries);
    return (type) => byType.get(type);
}

/** 参照の問題を、ターミナルに出す説明の列にする。 */
export function referenceWarnings(entities: readonly RefCheckEntity[], fieldsOf: FieldsOf): string[] {
    return findReferenceProblems(entities, fieldsOf).map((problem) =>
        describeReferenceProblem(problem, fieldsOf(problem.componentType)?.[problem.field]?.label ?? problem.field),
    );
}
