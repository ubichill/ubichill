/**
 * dev サーバーの「世代」。ビルドの結果を不変の単位にし、lock・manifest・Worker・asset・部屋を 1 つの世代として揃えて切り替える。
 * ブラウザは 1 つの世代を最初から最後まで使い、取得の途中で別の世代と混ざらない（URL に buildId が入る）。
 */
import {
    buildWorldLock,
    createDependencyAwareLockEntryGetter,
    type FetchLike,
    type LockEntryGetter,
} from '@ubichill/loader';
import type { Dependency, ModLock, ModLockEntry } from '@ubichill/shared';
import { lockedMods } from '@ubichill/shared';
import type { ModArtifacts } from '../build.ts';

export interface Generation {
    /** 配布物の世代。`<起動ごとの乱数>-<連番>`。dev サーバーを再起動しても前の値と衝突しない。Go の owner の世代（gen/epoch）とは別物。 */
    buildId: string;
    /** 全 mod の成果物（id → 成果物）。前の世代と変わらない mod は同じ参照を共有する。 */
    mods: ReadonlyMap<string, ModArtifacts>;
    /** 各エントリの baseUrl はこの世代の URL。 */
    lock: ModLock;
    /** この世代のブラウザが入る Go の部屋。mod のコードだけが変わったときは前の世代と同じ部屋を使う（entity が残る）。 */
    instanceId: string;
}

/** メモリに残す世代の数。それより古い世代の URL は 404 になり、そのページは読み直しで追いつく。 */
export const KEEP_GENERATIONS = 3;

export interface GenerationState {
    readonly runId: string;
    readonly seq: number;
    /** 新しい順。先頭が今の世代。 */
    readonly kept: readonly Generation[];
}

export const initialGenerationState = (runId: string): GenerationState => ({ runId, seq: 0, kept: [] });

/** 次の buildId を振る（単調増加。公開の順番と一致する）。 */
export function nextBuildId(state: GenerationState): { state: GenerationState; buildId: string } {
    const seq = state.seq + 1;
    return { state: { ...state, seq }, buildId: `${state.runId}-${seq}` };
}

/** 世代を公開する。古い世代は KEEP_GENERATIONS を超えたぶんから消える。 */
export function publishGeneration(state: GenerationState, generation: Generation): GenerationState {
    return { ...state, kept: [generation, ...state.kept].slice(0, KEEP_GENERATIONS) };
}

export const currentGeneration = (state: GenerationState): Generation | undefined => state.kept[0];

export const findGeneration = (state: GenerationState, buildId: string): Generation | undefined =>
    state.kept.find((g) => g.buildId === buildId);

/** 世代ごとの mod の取得元（lock の baseUrl）。 */
export const generationModsBase = (buildId: string): string => `/__ubichill/g/${buildId}/mods`;

/**
 * この世代の lock を作る。手元でビルドした mod はその成果物の lock（baseUrl を世代の URL にしたもの）を使い、
 * `dependencies[].source.url` に置き場所が書いてあっても手元を優先する（dev は作業中のコードを動かすためのもの）。
 * 手元に無い mod は `external` から取る。
 */
export async function buildGenerationLock(
    buildId: string,
    mods: ReadonlyMap<string, ModArtifacts>,
    modIds: readonly string[],
    external: LockEntryGetter,
): Promise<ModLock> {
    const baseUrl = generationModsBase(buildId);
    return buildWorldLock([...modIds], async (modId, version) => {
        const mod = mods.get(modId);
        return mod ? { ...mod.lockEntry, baseUrl } : external(modId, version);
    });
}

/** 外の置き場所（絶対 URL）を持つ entry か。相対や無しは手元の世代か Host の既定の置き場所で、dev からは取れない。 */
const hostedElsewhere = (entry: ModLockEntry | undefined): entry is ModLockEntry =>
    entry?.baseUrl !== undefined && !entry.baseUrl.startsWith('/');

/**
 * 手元に無い mod の取り先（ワールドを作り直すとき）。world.yaml の横の lock にあればその版（本番と同じ）、
 * 無ければ `source.url` から（`source.version` の固定か最新）。lock の版が `source.version` の固定と違う・置き場所が
 * `source.url` と違うときは、world.yaml を書き換えて `ubichill install` をし直していない古い lock なので使わない。
 */
export function externalLockEntries(
    dependencies: readonly Dependency[] | undefined,
    pinned: ModLock | undefined,
    fetchImpl?: FetchLike,
): LockEntryGetter {
    const remote = createDependencyAwareLockEntryGetter([...(dependencies ?? [])], async () => null, fetchImpl);
    const sources = new Map((dependencies ?? []).map((d) => [d.name, d.source]));
    return async (modId, version) => {
        const entry = lockedMods(pinned)[modId];
        const source = sources.get(modId);
        const sameVersion = !source || source.version === 'latest' || source.version === entry?.version;
        const samePlace = !source?.url || source.url === entry?.baseUrl;
        return hostedElsewhere(entry) && sameVersion && samePlace && (!source?.author || source.author === entry.author)
            ? entry
            : remote(modId, version);
    };
}

/** 前の世代が外から取った mod をそのまま使う（ワールドを作り直すまで、保存のたびに外へ取りに行かない）。 */
export function reuseExternalEntries(previous: Generation, fallback: LockEntryGetter): LockEntryGetter {
    return async (modId, version) => {
        const entry = lockedMods(previous.lock)[modId];
        return hostedElsewhere(entry) ? entry : fallback(modId, version);
    };
}

/**
 * 世代の切り替えで部屋を作り直すか。mod の集合か版が変わると、定義の activeMods が変わる。
 * world.yaml が無く mod から合成したワールドなら、初期の entity は Component から作るので、Component の集合が変わっても作り直す
 * （同じ版のまま Worker を足しても、新しい Component が部屋に現れるように）。
 */
export function needsNewRoom(
    previous: Generation | undefined,
    mods: ReadonlyMap<string, ModArtifacts>,
    options: { synthesized: boolean },
): boolean {
    if (!previous) return true;
    if (previous.mods.size !== mods.size) return true;
    const sameComponents = (a: readonly string[], b: readonly string[]) =>
        a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
    for (const [id, mod] of mods) {
        const before = previous.mods.get(id);
        if (!before || before.version !== mod.version) return true;
        if (options.synthesized && !sameComponents(before.components, mod.components)) return true;
    }
    return false;
}
