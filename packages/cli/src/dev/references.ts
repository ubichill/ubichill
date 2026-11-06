/**
 * `ubichill dev` で、ワールドの参照フィールド（`entityRef` / `entityRefArray`）の問題を mod の開発者に知らせる。
 * 判定は World Editor・Host と同じ `@ubichill/shared` の関数を使う。
 */
import {
    type DataFieldsLike,
    describeReferenceProblem,
    fieldLabel,
    findReferenceProblems,
    type RefCheckEntity,
} from '@ubichill/shared';
import type { ModArtifacts } from '../build.ts';

/** Component 型 → その dataFields。manifest は mod の開発者が書いた config のままなので、形は検証していない。 */
export type FieldsOf = (componentType: string) => DataFieldsLike | undefined;

/** 成果物の manifest.json から、Component 型ごとの dataFields を引けるようにする。 */
export function manifestFieldsOf(mods: Iterable<Pick<ModArtifacts, 'files'>>): FieldsOf {
    const decoder = new TextDecoder();
    const entries = [...mods].flatMap((mod) => {
        const bytes = mod.files.get('manifest.json');
        if (!bytes) return [];
        const manifest = JSON.parse(decoder.decode(bytes)) as {
            components?: Record<string, { dataFields?: DataFieldsLike }>;
        };
        return Object.entries(manifest.components ?? {}).map(([type, c]) => [type, c.dataFields] as const);
    });
    const byType = new Map(entries);
    return (type) => byType.get(type);
}

/** 参照の問題を、ターミナルに出す説明の列にする。 */
export function referenceWarnings(entities: readonly RefCheckEntity[], fieldsOf: FieldsOf): string[] {
    return findReferenceProblems(entities, fieldsOf).map((problem) =>
        describeReferenceProblem(problem, fieldLabel(fieldsOf(problem.componentType), problem.field)),
    );
}
