/**
 * dev サーバーの判断: いつ何をビルドし、世代をどう確定するか。
 *
 * 持つ状態は 3 つに分ける（混ぜると、失敗の後に何を残し何をやり直すかが追えなくなる）:
 *   - published（公開した世代）: ブラウザが今使っている世代と、その部屋の定義。公開に成功したときだけ変わる。
 *   - unpublished（まだ公開できていない変更）: 変わったと知らされたが、まだ世代に入っていない mod・ワールド。
 *     公開に成功するまで消さない。失敗した後の変更はここに合流し、次のビルドで一緒にやり直す。
 *   - discovered（監視の情報）: mod のディレクトリと、各 mod が読んだファイル。公開の成否と関係なく更新する
 *     （初回のビルドが失敗しても、直して保存すれば気づけるように）。
 *
 * 切り替えは「全部が成功したら最後に 1 回だけ公開する」。途中で失敗したら published も Go の部屋も触らない。
 *   1. 未反映の mod と、公開した世代に無い mod をビルドする（1 つでも失敗したら中止）
 *   2. 公開した世代の成果物と組み合わせ、新しい lock を作る
 *   3. 部屋を作り直すときだけ: ワールドを解決・検証し、新しい ID の部屋を Go に作る（拒否されたら中止。前の部屋はそのまま）
 *   4. 世代を公開し、SSE で知らせる。このビルドが反映した変更だけを unpublished から消す
 * 失敗は「今の診断」として持ち、変わるたびに丸ごと送る。出どころは 2 つで、混ぜずに持つ:
 *   - 最後のビルドの失敗（ビルドかワールド）。ビルドが成功すれば空にする（壊して直したが中身が公開中と同じで
 *     公開しなかったときも、ブラウザの診断が消える）
 *   - Go が起動し直したあとの部屋の作り直しの失敗。そのときは部屋を作り直す要求を残し、次のビルドで新しい部屋が
 *     できたときか、作り直しに成功したときに消す
 *   5. 部屋を作り直したときは、前の部屋をしばらくしてから消す（読み直し中のページを切らない）
 * ビルドは 1 つずつ。ビルド中に来た変更は次のビルドにまとめる（世代は作った順に公開される）。
 *
 * 名前の区別: buildId = 配布物（lock・manifest・Worker・asset）の世代、instanceId = Go の部屋。
 * Go の owner の世代（gen / epoch）は Go の中だけのもので、ここでは扱わない。
 */

import type { FetchLike } from '@ubichill/loader';
import {
    type DevEvent,
    type DevFailure,
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
    externalLockEntries,
    type Generation,
    type GenerationState,
    needsNewRoom,
    nextBuildId,
    publishGeneration,
    reuseExternalEntries,
} from './generation.ts';
import type { GoAdmin } from './goRuntime.ts';
import { manifestFieldsOf, referenceWarnings } from './references.ts';
import { componentsFromManifest, synthesizeWorld } from './synthesizedWorld.ts';

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
    /** world.yaml の横の `.lock.json`（あれば）。手元に無い mod はこの版を使う（本番と同じ）。 */
    lock?: ModLock;
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
    /** 手元に無い mod の lock を `source.url` から取る（テストで差し替える）。 */
    fetchImpl?: FetchLike;
}

export const RETIRE_DELAY_MS = 30000;

/** ビルドに失敗した mod すべて（1 つ目で止めると、直した順に 1 つずつしか分からない）。 */
export class BuildFailures extends Error {
    readonly failures: readonly { mod: string; message: string }[];
    constructor(failures: readonly { mod: string; message: string }[]) {
        super(failures.map((f) => `[${f.mod}] ${f.message}`).join('\n'));
        this.failures = failures;
    }
}
export class WorldError extends Error {}

export interface Pipeline {
    /** 公開した世代（ブラウザが使うもの）。 */
    readonly state: GenerationState;
    /** 変更を知らせる。ビルド中なら次のビルドにまとめる。失敗しても、公開できるまで変更は消えない。 */
    schedule(plan: RebuildPlan): void;
    /** 進行中のビルドが終わるまで待つ（テスト・終了処理）。 */
    idle(): Promise<void>;
    /** 監視の情報: 今の mod のディレクトリと、各 mod が読んだファイル。 */
    readonly modDirs: ReadonlyMap<string, string>;
    readonly inputsByMod: ReadonlyMap<string, ReadonlySet<string>>;
    /** Go が起動し直したあと、今の世代の部屋を作り直す。 */
    restoreRoom(): Promise<void>;
    /** 今の診断（最後のビルドの失敗）。SSE の接続の直後に送る。 */
    readonly diagnostics: readonly DevFailure[];
}

/** まだ公開できていない変更。値は変更の通し番号（ビルド中に同じものがもう一度変わったら、そのビルドでは消さない）。 */
interface Unpublished {
    mods: Map<string, number>;
    /** mod の一覧を探し直す（0 なら不要）。 */
    rescan: number;
    /** 部屋を作り直す（0 なら不要）。 */
    reconfigure: number;
}

/** world.yaml が無いときのワールド（手元の mod の manifest から作る。型を宣言した参照は配線しておく）。 */
export function synthesizeFromArtifacts(mods: ReadonlyMap<string, ModArtifacts>): Record<string, unknown> {
    return synthesizeWorld(
        [...mods.values()].map((m) => ({
            id: m.id,
            components: componentsFromManifest(m.components, m.files.get('manifest.json')),
        })),
        manifestFieldsOf(mods.values()),
    );
}

const SYNTHESIZED_URL = 'file:///dev/world.yaml';

/** 部屋に置くワールドを検証する（world.yaml か合成したワールド）。失敗は WorldError。 */
function roomWorld(world: WorldSource | undefined, mods: ReadonlyMap<string, ModArtifacts>) {
    const url = world?.url ?? SYNTHESIZED_URL;
    try {
        return { url, definition: validateWorldDefinition(world?.raw ?? synthesizeFromArtifacts(mods), url) };
    } catch (error) {
        throw new WorldError(error instanceof Error ? error.message : String(error));
    }
}

/** ワールドの参照の問題（未設定の必須参照・無い Entity・型の違う Entity）。手元の mod の manifest で判定する。 */
export function roomReferenceWarnings(
    world: WorldSource | undefined,
    mods: ReadonlyMap<string, ModArtifacts>,
): string[] {
    return referenceWarnings(roomWorld(world, mods).definition.spec.initialEntities, manifestFieldsOf(mods.values()));
}

/** 世代に入れる部屋の定義を作る（world.yaml か合成したワールド）。失敗は WorldError。 */
export async function buildRoomDefinition(
    world: WorldSource | undefined,
    mods: ReadonlyMap<string, ModArtifacts>,
    lock: ModLock,
    options: { instanceId: string; maxUsers: number },
): Promise<InstanceDefinition> {
    const { url, definition } = roomWorld(world, mods);
    const unlocked = requiredLockModIds(definition.spec).filter((id) => !lock.mods[id]);
    if (unlocked.length > 0) {
        const sourceOf = (id: string) => definition.spec.dependencies?.find((d) => d.name === id)?.source.url;
        const reasons = unlocked.map((id) => {
            const url = sourceOf(id);
            return url ? `${id}（${url} から取れません）` : `${id}（手元に無く、source.url もありません）`;
        });
        throw new WorldError(`ワールドが参照している mod を lock に固定できません: ${reasons.join(', ')}`);
    }
    const resolved = mapToResolved(definition, url, { kind: WorldSourceKind.Local, url }, { lock });
    return toInstanceDefinition(resolved, {
        id: options.instanceId,
        maxUsers: Math.min(options.maxUsers, resolved.capacity.max),
    });
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 手元に無い mod をどこから取ったか（lock の版か、source.url の版か）。無ければ空。 */
export function describeExternal(
    lock: ModLock,
    mods: ReadonlyMap<string, ModArtifacts>,
    pinned: ModLock | undefined,
): string {
    return Object.entries(lock.mods)
        .filter(([id]) => !mods.has(id))
        .map(([id, entry]) => {
            const fromLock = pinned?.mods[id]?.manifestIntegrity === entry.manifestIntegrity;
            return `${id}@${entry.version}（${fromLock ? 'lock' : 'source.url'}）`;
        })
        .join('、');
}

/** 成果物の中身が同じか。lock の断片は manifest（asset の hash を含む）と各 Worker の hash を持つので、それで比べる。 */
function sameContents(a: ReadonlyMap<string, ModArtifacts>, b: ReadonlyMap<string, ModArtifacts>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, mod] of b) {
        const before = a.get(id);
        if (!before || JSON.stringify(before.lockEntry) !== JSON.stringify(mod.lockEntry)) return false;
    }
    return true;
}

export function createPipeline(deps: PipelineDeps, initial: GenerationState): Pipeline {
    const retireDelay = deps.retireDelayMs ?? RETIRE_DELAY_MS;
    const later = deps.setTimeout ?? setTimeout;
    const published = {
        state: initial,
        // Go が落ちて起動し直したときに作り直すために、今の部屋の定義を持つ
        room: undefined as InstanceDefinition | undefined,
    };
    const unpublished: Unpublished = { mods: new Map(), rescan: 0, reconfigure: 0 };
    const discovered = {
        modDirs: new Map<string, string>() as ReadonlyMap<string, string>,
        inputsByMod: new Map<string, ReadonlySet<string>>(),
    };
    const control = {
        seq: 0,
        /** 最後のビルドの後に知らせが来たか。失敗の後は、次の知らせまでやり直さない（同じ失敗を繰り返さない）。 */
        notified: false,
        running: null as Promise<void> | null,
    };
    const diagnostics = {
        build: [] as readonly DevFailure[],
        room: [] as readonly DevFailure[],
        references: [] as readonly DevFailure[],
        current: [] as readonly DevFailure[],
    };

    /** 診断の片方を差し替え、合わせた一覧が変わったときだけ送る。 */
    function setDiagnostics(source: 'build' | 'room' | 'references', next: readonly DevFailure[]): void {
        diagnostics[source] = next;
        const merged = [...diagnostics.build, ...diagnostics.room, ...diagnostics.references];
        if (JSON.stringify(merged) === JSON.stringify(diagnostics.current)) return;
        diagnostics.current = merged;
        deps.broadcast({ type: 'diagnostics', failures: merged });
    }

    /** 未反映の変更を記録する。 */
    function record(plan: RebuildPlan): void {
        const seq = ++control.seq;
        if (plan.mods === 'all') unpublished.rescan = seq;
        else for (const id of plan.mods) unpublished.mods.set(id, seq);
        if (plan.reconfigure) unpublished.reconfigure = seq;
        control.notified = true;
    }

    /** このビルドが反映した変更だけを消す（ビルド中にもう一度変わったものは残す）。 */
    function settle(taken: Unpublished): void {
        for (const [id, seq] of taken.mods) if (unpublished.mods.get(id) === seq) unpublished.mods.delete(id);
        if (unpublished.rescan === taken.rescan) unpublished.rescan = 0;
        if (unpublished.reconfigure === taken.reconfigure) unpublished.reconfigure = 0;
    }

    async function compileMods(taken: Unpublished): Promise<ReadonlyMap<string, ModArtifacts>> {
        const previous = currentGeneration(published.state)?.mods ?? new Map<string, ModArtifacts>();
        // 監視の情報は公開の成否と切り離す: 見つけた mod はビルドが失敗しても監視する
        if (taken.rescan || discovered.modDirs.size === 0) discovered.modDirs = await deps.discoverMods();
        const mods = new Map<string, ModArtifacts>();
        const failures: { mod: string; message: string }[] = [];
        for (const [id, dir] of discovered.modDirs) {
            const kept = previous.get(id);
            if (kept && !taken.mods.has(id) && !taken.rescan) {
                mods.set(id, kept);
                continue;
            }
            try {
                const artifacts = await deps.compile(dir);
                mods.set(artifacts.id, artifacts);
                discovered.inputsByMod.set(artifacts.id, artifacts.inputs);
            } catch (error) {
                failures.push({ mod: id, message: errorMessage(error) });
            }
        }
        for (const id of discovered.inputsByMod.keys())
            if (!discovered.modDirs.has(id)) discovered.inputsByMod.delete(id);
        if (failures.length > 0) throw new BuildFailures(failures);
        return mods;
    }

    /** 参照の問題を知らせる。前と同じならターミナルには出し直さない。 */
    function reportReferences(warnings: readonly string[]): void {
        const next = warnings.map((message): DevFailure => ({ kind: 'reference', message }));
        if (JSON.stringify(next) !== JSON.stringify(diagnostics.references)) {
            for (const message of warnings) deps.log(`参照の問題: ${message}`);
        }
        setDiagnostics('references', next);
    }

    function report(error: unknown): void {
        if (error instanceof BuildFailures) {
            for (const f of error.failures) deps.log(`❌ [${f.mod}] ビルドに失敗: ${f.message}`);
            setDiagnostics(
                'build',
                error.failures.map((f) => ({ kind: 'build', mod: f.mod, message: f.message })),
            );
            return;
        }
        const message = errorMessage(error);
        deps.log(`❌ ワールドを作れません: ${message}`);
        setDiagnostics('build', [{ kind: 'world', message }]);
    }

    async function run(): Promise<void> {
        control.notified = false;
        const taken: Unpublished = {
            mods: new Map(unpublished.mods),
            rescan: unpublished.rescan,
            reconfigure: unpublished.reconfigure,
        };
        const previous = currentGeneration(published.state);
        try {
            const mods = await compileMods(taken);
            // 中身が変わっていない（保存しただけ）なら公開しない。開いているページを無駄に読み直させない
            if (previous && !taken.reconfigure && sameContents(previous.mods, mods)) {
                settle(taken);
                setDiagnostics('build', []);
                return;
            }
            const { state, buildId } = nextBuildId(published.state);
            const world = await deps.loadWorld();
            const definition = (() => {
                try {
                    return world ? validateWorldDefinition(world.raw, world.url) : undefined;
                } catch (error) {
                    throw new WorldError(errorMessage(error));
                }
            })();
            const modIds = definition ? requiredLockModIds(definition.spec) : [...mods.keys()];
            // 手元に無い mod は、ワールドを作り直すときだけ取り直す（保存のたびに外へ取りに行かない）
            const fresh = externalLockEntries(definition?.spec.dependencies, world?.lock, deps.fetchImpl);
            const external = previous && !taken.reconfigure ? reuseExternalEntries(previous, fresh) : fresh;
            const lock = await buildGenerationLock(buildId, mods, modIds, external);
            // 合成したワールドは mod の manifest（Component・置き場所・参照の宣言）から初期の entity を作るので、
            // 合成の結果が変わったら部屋を作り直す（版と Component が同じでも、参照を足せば配線が変わる）
            const synthesizedChanged =
                !world &&
                !!previous &&
                JSON.stringify(synthesizeFromArtifacts(previous.mods)) !==
                    JSON.stringify(synthesizeFromArtifacts(mods));
            const newRoom =
                !previous ||
                taken.reconfigure > 0 ||
                synthesizedChanged ||
                needsNewRoom(previous, mods, { synthesized: !world });
            const instanceId = newRoom ? `dev-${buildId}` : (previous as Generation).instanceId;
            const room = newRoom
                ? await buildRoomDefinition(world, mods, lock, { instanceId, maxUsers: deps.maxUsers })
                : published.room;
            if (newRoom && room) {
                const go = deps.go();
                if (!go) throw new WorldError('Go のインスタンスサーバーが動いていません');
                const result = await go.putInstance(room);
                if (!result.ok) throw new WorldError(`Go が部屋を作れません (${result.status}): ${result.error}`);
            }
            // 参照の検査は部屋を作り直さないビルドでも毎回行う（mod の参照の宣言だけが変わることがある）。止めはしない
            const references = roomReferenceWarnings(world, mods);
            // ここから先は失敗しない: 公開して、反映した変更を消す
            published.state = publishGeneration(state, { buildId, mods, lock, instanceId });
            published.room = room;
            settle(taken);
            deps.broadcast({ type: 'generation', buildId, instanceId });
            setDiagnostics('build', []);
            if (newRoom) setDiagnostics('room', []);
            reportReferences(references);
            deps.log(
                `✅ 世代 ${buildId}（mod ${Object.keys(lock.mods).length}・うち手元 ${mods.size}、部屋 ${instanceId}${newRoom ? '・作り直し' : ''}）`,
            );
            if (!previous || taken.reconfigure) {
                const outside = describeExternal(lock, mods, world?.lock);
                if (outside) deps.log(`   外の mod: ${outside}`);
            }
            if (newRoom && previous && previous.instanceId !== instanceId) {
                const retired = previous.instanceId;
                later(() => void deps.go()?.deleteInstance(retired), retireDelay);
            }
        } catch (error) {
            report(error);
        }
    }

    async function drain(): Promise<void> {
        while (control.notified) await run();
    }

    return {
        get state() {
            return published.state;
        },
        get modDirs() {
            return discovered.modDirs;
        },
        get inputsByMod() {
            return discovered.inputsByMod;
        },
        get diagnostics() {
            return diagnostics.current;
        },
        schedule(plan) {
            record(plan);
            if (!control.running) {
                control.running = drain().finally(() => {
                    control.running = null;
                });
            }
        },
        idle: () => control.running ?? Promise.resolve(),
        async restoreRoom() {
            const room = published.room;
            const go = deps.go();
            if (!room || !go) return;
            // 起動し直した直後にまた落ちると putInstance が投げる。投げたままにすると node ごと落ちる
            const failure = await go.putInstance(room).then(
                (result) => (result.ok ? null : `Go が部屋を作れません (${result.status}): ${result.error}`),
                (error: unknown) => `Go が部屋を作れません: ${errorMessage(error)}`,
            );
            if (!failure) {
                deps.log(`♻️  部屋 ${room.id} を作り直しました（状態は初期に戻ります）`);
                setDiagnostics('room', []);
                return;
            }
            deps.log(`❌ ${failure}`);
            setDiagnostics('room', [{ kind: 'world', message: failure }]);
            // Go に部屋が無いままなので、次のビルドでは中身が同じでも新しい部屋を作る
            unpublished.reconfigure = ++control.seq;
        },
    };
}
