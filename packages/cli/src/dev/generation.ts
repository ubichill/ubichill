/**
 * dev サーバーの「世代」。ビルドの結果を不変の単位にし、lock・manifest・Worker・asset・部屋を 1 つの世代として揃えて切り替える。
 * ブラウザは 1 つの世代を最初から最後まで使い、取得の途中で別の世代と混ざらない（URL に buildId が入る）。
 */
import { buildWorldLock, createDependencyAwareLockEntryGetter, type LockEntryGetter } from '@ubichill/loader';
import type { Dependency, ModLock } from '@ubichill/shared';
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
 * この世代の lock を作る。手元でビルドした mod はその成果物の lock（baseUrl を世代の URL にしたもの）、
 * `dependencies[].source.url` の外部の mod はその置き場所から取る（`ubichill install` と同じ規則）。
 */
export async function buildGenerationLock(
    buildId: string,
    mods: ReadonlyMap<string, ModArtifacts>,
    modIds: readonly string[],
    dependencies: Dependency[] | undefined,
    fetchImpl?: Parameters<typeof createDependencyAwareLockEntryGetter>[2],
): Promise<ModLock> {
    const baseUrl = generationModsBase(buildId);
    const local: LockEntryGetter = async (modId) => {
        const mod = mods.get(modId);
        return mod ? { ...mod.lockEntry, baseUrl } : null;
    };
    return buildWorldLock([...modIds], createDependencyAwareLockEntryGetter(dependencies, local, fetchImpl));
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
        a.length === b.length && [...a].sort().every((type, i) => type === [...b].sort()[i]);
    for (const [id, mod] of mods) {
        const before = previous.mods.get(id);
        if (!before || before.version !== mod.version) return true;
        if (options.synthesized && !sameComponents(before.components, mod.components)) return true;
    }
    return false;
}
