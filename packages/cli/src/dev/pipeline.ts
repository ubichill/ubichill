/**
 * dev サーバーの判断: いつ何をビルドし、世代をどう確定するか。
 *
 * 切り替えは「全部が成功したら最後に 1 回だけ公開する」。途中で失敗したら、今の世代も Go の部屋も触らない。
 *   1. 対象の mod をビルドする（1 つでも失敗したら中止）
 *   2. 前の世代の成果物と組み合わせ、新しい lock を作る
 *   3. 部屋を作り直すときだけ: world.yaml を解決・検証し、新しい ID の部屋を Go に作る（拒否されたら中止。前の部屋はそのまま）
 *   4. 世代を公開し、SSE で知らせる
 *   5. 部屋を作り直したときは、前の部屋をしばらくしてから消す（読み直し中のページを切らない）
 * ビルドは 1 つずつ。ビルド中に来た変更はためておき、終わったら 1 回にまとめる（世代は作った順に公開される）。
 */
import {
    type InstanceDefinition,
    type ModLock,
    mapToResolved,
    requiredLockModIds,
    toInstanceDefinition,
    validateWorldDefinition,
    WorldSourceKind,
} from '@ubichill/shared';
import type { ModArtifacts } from '../build.ts';
import {
    buildGenerationLock,
    currentGeneration,
    type Generation,
    type GenerationState,
    needsNewRoom,
    nextBuildId,
    publishGeneration,
} from './generation.ts';
import type { GoAdmin } from './goRuntime.ts';
import type { DevEvent } from './server.ts';
import { synthesizeWorld } from './synthesizedWorld.ts';

export interface RebuildPlan {
    /** ビルドし直す mod の id。`'all'` は全部（最初・mod の一覧が変わったとき）。 */
    mods: ReadonlySet<string> | 'all';
    /** ワールドを作り直す（world.yaml の変更・部屋を作り直すボタン）。 */
    reconfigure: boolean;
}

export interface WorldSource {
    /** 生の定義（YAML をパースしたもの）。無ければ mod から合成する。 */
    raw: unknown;
    /** 表示と ID に使う。 */
    url: string;
}

export interface PipelineDeps {
    /** mod の id → ディレクトリ。`'all'` のときに探し直す。 */
    discoverMods: () => Promise<ReadonlyMap<string, string>>;
    compile: (modDir: string) => Promise<ModArtifacts>;
    /** world.yaml を読む（無ければ undefined）。 */
    loadWorld: () => Promise<WorldSource | undefined>;
    go: () => GoAdmin | undefined;
    broadcast: (event: DevEvent) => void;
    log: (line: string) => void;
    maxUsers: number;
    /** 前の部屋を消すまでの時間。 */
    retireDelayMs?: number;
    setTimeout?: (fn: () => void, ms: number) => void;
}

export const RETIRE_DELAY_MS = 30000;

export class BuildError extends Error {
    readonly mod: string;
    constructor(mod: string, message: string) {
        super(message);
        this.mod = mod;
    }
}
export class WorldError extends Error {}

export interface Pipeline {
    readonly state: GenerationState;
    /** 変更を予約する。ビルド中なら次のビルドにまとめる。 */
    schedule(plan: RebuildPlan): void;
    /** 進行中のビルドが終わるまで待つ（テスト・終了処理）。 */
    idle(): Promise<void>;
    /** 今の mod のディレクトリと入力（監視の対象）。 */
    readonly modDirs: ReadonlyMap<string, string>;
    readonly inputsByMod: ReadonlyMap<string, ReadonlySet<string>>;
    /** Go が起動し直したあと、今の世代の部屋を作り直す。 */
    restoreRoom(): Promise<void>;
}

const mergePlans = (a: RebuildPlan | null, b: RebuildPlan): RebuildPlan => ({
    mods:
        !a || a.mods === 'all' || b.mods === 'all'
            ? a?.mods === 'all' || b.mods === 'all'
                ? 'all'
                : b.mods
            : new Set([...a.mods, ...b.mods]),
    reconfigure: (a?.reconfigure ?? false) || b.reconfigure,
});

/** 世代に入れる部屋の定義を作る（world.yaml か合成したワールド）。失敗は WorldError。 */
export async function buildRoomDefinition(
    world: WorldSource | undefined,
    mods: ReadonlyMap<string, ModArtifacts>,
    lock: ModLock,
    options: { instanceId: string; maxUsers: number },
): Promise<InstanceDefinition> {
    const raw = world?.raw ?? synthesizeWorld([...mods.values()].map((m) => ({ id: m.id, components: m.components })));
    const url = world?.url ?? 'file:///dev/world.yaml';
    const definition = (() => {
        try {
            return validateWorldDefinition(raw, url);
        } catch (error) {
            throw new WorldError(error instanceof Error ? error.message : String(error));
        }
    })();
    const unlocked = requiredLockModIds(definition.spec).filter((id) => !lock.mods[id]);
    if (unlocked.length > 0) {
        throw new WorldError(`ワールドが参照している mod が手元に無く、lock に固定できません: ${unlocked.join(', ')}`);
    }
    const resolved = mapToResolved(definition, url, { kind: WorldSourceKind.Local, url }, { lock });
    return toInstanceDefinition(resolved, {
        id: options.instanceId,
        maxUsers: Math.min(options.maxUsers, resolved.capacity.max),
    });
}

export function createPipeline(deps: PipelineDeps, initial: GenerationState): Pipeline {
    const retireDelay = deps.retireDelayMs ?? RETIRE_DELAY_MS;
    const later = deps.setTimeout ?? setTimeout;
    const self = {
        state: initial,
        modDirs: new Map<string, string>() as ReadonlyMap<string, string>,
        inputsByMod: new Map<string, ReadonlySet<string>>() as ReadonlyMap<string, ReadonlySet<string>>,
        pending: null as RebuildPlan | null,
        running: null as Promise<void> | null,
        // 部屋の定義は Go が落ちて起動し直したときに作り直すために持つ
        roomDefinition: undefined as InstanceDefinition | undefined,
    };

    async function compileMods(plan: RebuildPlan): Promise<ReadonlyMap<string, ModArtifacts>> {
        const previous = currentGeneration(self.state)?.mods ?? new Map<string, ModArtifacts>();
        const modDirs = plan.mods === 'all' ? await deps.discoverMods() : self.modDirs;
        const targets = plan.mods === 'all' ? new Set(modDirs.keys()) : plan.mods;
        const mods = new Map<string, ModArtifacts>();
        const inputs = new Map<string, ReadonlySet<string>>();
        for (const [id, dir] of modDirs) {
            const kept = previous.get(id);
            if (!targets.has(id) && kept) {
                mods.set(id, kept);
                inputs.set(id, self.inputsByMod.get(id) ?? new Set());
                continue;
            }
            try {
                const artifacts = await deps.compile(dir);
                mods.set(artifacts.id, artifacts);
                inputs.set(artifacts.id, artifacts.inputs);
            } catch (error) {
                throw new BuildError(id, error instanceof Error ? error.message : String(error));
            }
        }
        self.modDirs = modDirs;
        self.inputsByMod = inputs;
        return mods;
    }

    async function run(plan: RebuildPlan): Promise<void> {
        const previous = currentGeneration(self.state);
        try {
            const mods = await compileMods(plan);
            const { state, buildId } = nextBuildId(self.state);
            const world = await deps.loadWorld();
            const definition = world ? validateWorldDefinition(world.raw, world.url) : undefined;
            const modIds = definition ? requiredLockModIds(definition.spec) : [...mods.keys()];
            const lock = await buildGenerationLock(buildId, mods, modIds, definition?.spec.dependencies);
            const newRoom = plan.reconfigure || needsNewRoom(previous, mods) || !previous;
            const instanceId = newRoom ? `dev-${buildId}` : (previous as Generation).instanceId;
            if (newRoom) {
                const roomDefinition = await buildRoomDefinition(world, mods, lock, {
                    instanceId,
                    maxUsers: deps.maxUsers,
                });
                const go = deps.go();
                if (!go) throw new WorldError('Go のインスタンスサーバーが動いていません');
                const result = await go.putInstance(roomDefinition);
                if (!result.ok) throw new WorldError(`Go が部屋を作れません (${result.status}): ${result.error}`);
                self.roomDefinition = roomDefinition;
            }
            const generation: Generation = { buildId, mods, lock, instanceId };
            self.state = publishGeneration(state, generation);
            deps.broadcast({ type: 'generation', buildId, instanceId });
            deps.log(`✅ 世代 ${buildId}（mod ${mods.size}、部屋 ${instanceId}${newRoom ? '・作り直し' : ''}）`);
            if (newRoom && previous && previous.instanceId !== instanceId) {
                const retired = previous.instanceId;
                later(() => void deps.go()?.deleteInstance(retired), retireDelay);
            }
        } catch (error) {
            if (error instanceof BuildError) {
                deps.log(`❌ [${error.mod}] ビルドに失敗: ${error.message}`);
                deps.broadcast({ type: 'build-error', mod: error.mod, message: error.message });
            } else {
                const message = error instanceof Error ? error.message : String(error);
                deps.log(`❌ ワールドを作れません: ${message}`);
                deps.broadcast({ type: 'world-error', message });
            }
        }
    }

    function drain(): Promise<void> {
        const plan = self.pending;
        if (!plan) return Promise.resolve();
        self.pending = null;
        return run(plan).then(drain);
    }

    return {
        get state() {
            return self.state;
        },
        get modDirs() {
            return self.modDirs;
        },
        get inputsByMod() {
            return self.inputsByMod;
        },
        schedule(plan) {
            self.pending = mergePlans(self.pending, plan);
            if (!self.running) {
                self.running = drain().finally(() => {
                    self.running = null;
                });
            }
        },
        idle: () => self.running ?? Promise.resolve(),
        async restoreRoom() {
            const definition = self.roomDefinition;
            const go = deps.go();
            if (!definition || !go) return;
            const result = await go.putInstance(definition);
            if (result.ok) deps.log(`♻️  部屋 ${definition.id} を作り直しました（状態は初期に戻ります）`);
            else
                deps.broadcast({
                    type: 'world-error',
                    message: `Go が部屋を作れません (${result.status}): ${result.error}`,
                });
        },
    };
}
