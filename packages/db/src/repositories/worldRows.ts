import type { ModLock, WorldSignature } from '@ubichill/shared';
import type { worldDrafts, worlds, worldVersions } from '../schema';

/** ワールドの所有と名前（中身は版と下書き）。0023 より前の列は含めない（新しいコードは読まない）。 */
export type WorldRecord = Pick<
    typeof worlds.$inferSelect,
    'id' | 'authorId' | 'worldName' | 'currentVersionId' | 'createdAt' | 'updatedAt'
>;
export type WorldVersionRecord = typeof worldVersions.$inferSelect;
export type WorldDraftRecord = typeof worldDrafts.$inferSelect;

/** ワールドと、公開中の版・下書き。 */
export interface WorldState {
    world: WorldRecord;
    current?: WorldVersionRecord;
    draft?: WorldDraftRecord;
}

/** 配る中身（YAML・`.lock.json`・`.sig.json` と、その metadata.version）。 */
export interface ServedWorld {
    definition: unknown;
    lock: ModLock | null;
    signature: WorldSignature | null;
    version: string;
    /** 公開中の版から配るときだけ（インスタンスに記録する）。 */
    versionId?: string;
}

/** 生の definition の metadata.version（保存の前にスキーマを通しているので、普通は必ずある）。 */
export function definitionVersionOf(definition: unknown): string {
    const metadata = (definition as { metadata?: { version?: unknown } } | null)?.metadata;
    return typeof metadata?.version === 'string' ? metadata.version : '';
}

/**
 * 配る中身。公開中の版があればそれ（下書きは配らない）、未公開なら下書きを署名なしとして配る。
 * 0023 より前の 1 行の形（公開中は definition/lock/signature、未公開は署名なしの definition）と同じものを返す。
 */
export function servedWorldOf(state: WorldState): ServedWorld | undefined {
    const { current, draft } = state;
    if (current) {
        return {
            definition: current.definition,
            lock: current.lock ?? null,
            signature: current.signature ?? null,
            version: current.version,
            versionId: current.id,
        };
    }
    if (!draft) return undefined;
    return {
        definition: draft.definition,
        lock: draft.lock ?? null,
        signature: null,
        version: definitionVersionOf(draft.definition),
    };
}

/**
 * エディタに渡す定義。下書きがあれば下書き。`hasDraft` は「公開中の版と別に下書きがある」とき
 * （未公開のワールドは下書きそのものが中身なので false。0023 より前と同じ意味）。
 */
export function editorWorldOf(state: WorldState): { definition: unknown; hasDraft: boolean } | undefined {
    const definition = state.draft?.definition ?? state.current?.definition;
    if (definition === undefined) return undefined;
    return { definition, hasDraft: !!state.draft && !!state.current };
}

/**
 * 残す数を超えた版（消す候補）。公開中の版は必ず残し、残りは新しい順に、合わせて `max` になるまで残す。
 * 候補でも、インスタンスが指している版は消さない（DB の RESTRICT と、消す SQL の条件で守る）。
 */
export function versionsToPrune(
    versions: ReadonlyArray<Pick<WorldVersionRecord, 'id' | 'publishedAt'>>,
    currentVersionId: string | null,
    max: number,
): string[] {
    const keepOthers = Math.max(0, Math.max(1, max) - (currentVersionId ? 1 : 0));
    return [...versions]
        .filter((v) => v.id !== currentVersionId)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(keepOthers)
        .map((v) => v.id);
}
