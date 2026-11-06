/**
 * 世代を確定する順序。失敗した段階で何が残るかは docs/design/world-runtime-dev.md の表の通り。
 */
import { type DevEvent, EMPTY_ENTITY_TYPE, type InstanceDefinition } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ModArtifacts } from '../build.ts';
import { fakeMod, remoteMods } from './generation.test.ts';
import { currentGeneration, initialGenerationState } from './generation.ts';
import type { GoAdmin } from './goRuntime.ts';
import { buildRoomDefinition, createPipeline, type PipelineDeps, type WorldSource } from './pipeline.ts';

/** 最後に送った診断。 */
const lastDiagnostics = (events: readonly DevEvent[]) =>
    events.findLast((e): e is Extract<DevEvent, { type: 'diagnostics' }> => e.type === 'diagnostics')?.failures;

/** 中身を変えた mod（lock の断片の hash が変わる）。 */
const edited = (mod: ModArtifacts, mark: string): ModArtifacts => ({
    ...mod,
    lockEntry: { ...mod.lockEntry, manifestIntegrity: `sha256-${mark.repeat(43)}=` },
});

const worldYaml = (deps: string[] = ['pen']): WorldSource => ({
    url: 'file:///p/world.yaml',
    raw: {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'home', version: '1.0.0' },
        spec: {
            displayName: 'Home',
            capacity: { default: 4, max: 8 },
            dependencies: deps.map((name) => ({ name, source: { version: 'latest' } })),
            initialEntities: deps.map((name) => ({
                id: name,
                transform: { x: 1, y: 2 },
                components: [{ type: `${name}:main` }],
            })),
        },
    },
});

function fakeGo(reject?: (definition: InstanceDefinition) => string | null) {
    const puts: InstanceDefinition[] = [];
    const deletes: string[] = [];
    const admin: GoAdmin = {
        async putInstance(definition) {
            const error = reject?.(definition);
            if (error) return { ok: false, status: 400, error };
            puts.push(definition);
            return { ok: true };
        },
        async deleteInstance(id) {
            deletes.push(id);
        },
    };
    return { admin, puts, deletes };
}

function harness(overrides: Partial<PipelineDeps> = {}) {
    const go = fakeGo();
    const events: DevEvent[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const mods = new Map<string, ModArtifacts>([['pen', fakeMod('pen')]]);
    const compile = vi.fn(async (dir: string) => {
        const id = dir.split('/').pop() as string;
        const mod = mods.get(id);
        if (!mod) throw new Error(`no such mod ${id}`);
        return mod;
    });
    const deps: PipelineDeps = {
        discoverMods: async () => new Map([...mods.keys()].map((id) => [id, `/mods/${id}`])),
        compile,
        loadWorld: async () => worldYaml(),
        go: () => go.admin,
        broadcast: (event) => events.push(event),
        log: () => {},
        maxUsers: 20,
        setTimeout: (fn, ms) => timers.push({ fn, ms }),
        ...overrides,
    };
    const pipeline = createPipeline(deps, initialGenerationState('r'));
    return { pipeline, go, events, timers, mods, compile };
}

describe('createPipeline', () => {
    it('最初のビルド: 全 mod をビルドし、部屋を作ってから世代を公開する（PUT が generation より先）', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        const current = currentGeneration(h.pipeline.state);
        expect(current?.buildId).toBe('r-1');
        expect(current?.instanceId).toBe('dev-r-1');
        expect(current?.lock.mods.pen?.baseUrl).toBe('/__ubichill/g/r-1/mods');
        expect(h.go.puts.map((d) => d.id)).toEqual(['dev-r-1']);
        expect(h.go.puts[0]?.maxUsers).toBe(8); // ワールドの定員の上限を超えない
        expect(h.events).toEqual([{ type: 'generation', buildId: 'r-1', instanceId: 'dev-r-1' }]);
        expect(h.timers).toEqual([]); // 前の部屋は無いので消さない
    });

    it('mod のコードだけの変更は部屋を変えず（entity が残る）、版が変わると新しい部屋を作って前の部屋を 30 秒後に消す', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.mods.set('pen', edited(fakeMod('pen'), 'B'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)).toMatchObject({ buildId: 'r-2', instanceId: 'dev-r-1' });
        expect(h.go.puts).toHaveLength(1);

        h.mods.set('pen', fakeMod('pen', '1.1.0'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)).toMatchObject({ buildId: 'r-3', instanceId: 'dev-r-3' });
        expect(h.go.puts.map((d) => d.id)).toEqual(['dev-r-1', 'dev-r-3']);
        expect(h.go.deletes).toEqual([]);
        expect(h.timers).toHaveLength(1);
        expect(h.timers[0]?.ms).toBe(30000);
        h.timers[0]?.fn();
        await Promise.resolve();
        expect(h.go.deletes).toEqual(['dev-r-1']);
    });

    it('ビルドに失敗したら前の世代と部屋のまま、診断だけを送る', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.compile.mockRejectedValueOnce(new Error('syntax error in pen.worker.tsx'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.buildId).toBe('r-1');
        expect(h.events.at(-1)).toEqual({
            type: 'diagnostics',
            failures: [{ kind: 'build', mod: 'pen', message: 'syntax error in pen.worker.tsx' }],
        });
        expect(h.pipeline.diagnostics).toEqual(lastDiagnostics(h.events));
        expect(h.go.puts).toHaveLength(1);
        expect(h.go.deletes).toEqual([]);
    });

    it('world.yaml が壊れている・lock に無い mod を参照しているとワールドの診断で止まり、Go には送らない', async () => {
        const broken = harness({ loadWorld: async () => ({ url: 'file:///p/world.yaml', raw: { kind: 'World' } }) });
        broken.pipeline.schedule({ mods: 'all', reconfigure: true });
        await broken.pipeline.idle();
        expect(currentGeneration(broken.pipeline.state)).toBeUndefined();
        expect(lastDiagnostics(broken.events)).toEqual([{ kind: 'world', message: expect.stringContaining('無効') }]);
        expect(broken.go.puts).toEqual([]);

        const missing = harness({ loadWorld: async () => worldYaml(['pen', 'ghost']) });
        missing.pipeline.schedule({ mods: 'all', reconfigure: true });
        await missing.pipeline.idle();
        expect(lastDiagnostics(missing.events)).toEqual([{ kind: 'world', message: expect.stringContaining('ghost') }]);
        expect(missing.go.puts).toEqual([]);
    });

    it('取れなかった mod は、手元に無いのか source.url から取れないのかを分けて知らせる', async () => {
        const world = worldYaml(['ghost', 'remote']);
        const spec = (world.raw as { spec: { dependencies: { name: string; source: object }[] } }).spec;
        spec.dependencies = [
            { name: 'ghost', source: { version: 'latest' } },
            { name: 'remote', source: { url: 'https://mods.example/x', version: 'latest' } },
        ];
        await expect(
            buildRoomDefinition(world, new Map(), { lockVersion: 1, mods: {} }, { instanceId: 'dev-1', maxUsers: 4 }),
        ).rejects.toThrow(
            /ghost（手元に無く、source\.url もありません）.*remote（https:\/\/mods\.example\/x から取れません）/,
        );
    });

    it('Go が PUT を拒否したら前の世代と前の部屋のまま（DELETE も送らない）', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        const rejecting = fakeGo((d) => (d.id === 'dev-r-2' ? 'instance definition is too large' : null));
        const deps = { go: () => rejecting.admin };
        const h2 = harness(deps);
        h2.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h2.pipeline.idle();
        h2.pipeline.schedule({ mods: new Set(), reconfigure: true });
        await h2.pipeline.idle();
        expect(currentGeneration(h2.pipeline.state)).toMatchObject({ buildId: 'r-1', instanceId: 'dev-r-1' });
        expect(lastDiagnostics(h2.events)).toEqual([{ kind: 'world', message: expect.stringContaining('too large') }]);
        expect(rejecting.deletes).toEqual([]);
        expect(h2.timers).toEqual([]);
    });

    it('ビルド中に来た変更は 1 回にまとめ、世代は作った順に公開される', async () => {
        const gate = { resolve: () => {} };
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.compile.mockImplementationOnce(
            () => new Promise((resolve) => (gate.resolve = () => resolve(edited(fakeMod('pen'), 'B')))),
        );
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: true });
        gate.resolve();
        await h.pipeline.idle();
        const ids = h.events.filter((e) => e.type === 'generation').map((e) => (e as { buildId: string }).buildId);
        expect(ids).toEqual(['r-1', 'r-2', 'r-3']);
        expect(h.compile).toHaveBeenCalledTimes(3); // 最初 + ゲート + まとめた 1 回
        expect(currentGeneration(h.pipeline.state)?.instanceId).toBe('dev-r-3'); // まとめた分の reconfigure が効く
    });

    it('world.yaml が無ければ mod から合成したワールドで部屋を作る', async () => {
        const h = harness({ loadWorld: async () => undefined });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        const put = h.go.puts[0];
        expect(put?.name).toBe('ubichill dev');
        expect(put?.snapshot.entities.filter((e) => e.type !== EMPTY_ENTITY_TYPE).map((e) => e.type)).toEqual([
            'pen:main',
        ]);
        expect(put?.snapshot.activeMods).toEqual(['pen']);
    });

    it('Go が起動し直したら今の部屋を作り直す', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        await h.pipeline.restoreRoom();
        expect(h.go.puts.map((d) => d.id)).toEqual(['dev-r-1', 'dev-r-1']);
    });

    it('部屋の作り直しに失敗しても、ビルドの診断を消さずに並べ、Go が投げても落ちない', async () => {
        const state = { mode: 'ok' as 'ok' | 'reject' | 'throw' };
        const go = fakeGo();
        const admin: GoAdmin = {
            ...go.admin,
            async putInstance(definition) {
                if (state.mode === 'throw') throw new Error('ECONNREFUSED');
                if (state.mode === 'reject') return { ok: false, status: 503, error: 'draining' };
                return go.admin.putInstance(definition);
            },
        };
        const h = harness({ go: () => admin });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.compile.mockRejectedValueOnce(new Error('broken'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();

        state.mode = 'throw';
        await expect(h.pipeline.restoreRoom()).resolves.toBeUndefined();
        expect(h.pipeline.diagnostics).toEqual([
            { kind: 'build', mod: 'pen', message: 'broken' },
            { kind: 'world', message: expect.stringContaining('ECONNREFUSED') },
        ]);

        state.mode = 'ok';
        await h.pipeline.restoreRoom();
        expect(h.pipeline.diagnostics).toEqual([{ kind: 'build', mod: 'pen', message: 'broken' }]);
    });

    it('部屋の作り直しに失敗したら、次の保存は中身が同じでも新しい部屋を作り、そこで診断が消える', async () => {
        const state = { reject: false };
        const go = fakeGo(() => (state.reject ? 'draining' : null));
        const h = harness({ go: () => go.admin });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        state.reject = true;
        await h.pipeline.restoreRoom();
        expect(h.pipeline.diagnostics).toHaveLength(1);

        state.reject = false;
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.instanceId).toBe('dev-r-2');
        expect(h.pipeline.diagnostics).toEqual([]);
    });
});

describe('buildRoomDefinition', () => {
    it('定員は --max-users とワールドの上限の小さい方', async () => {
        const mods = new Map([['pen', fakeMod('pen')]]);
        const lock = { lockVersion: 1 as const, mods: { pen: fakeMod('pen').lockEntry } };
        const def = await buildRoomDefinition(worldYaml(), mods, lock, { instanceId: 'dev-x', maxUsers: 3 });
        expect(def.maxUsers).toBe(3);
        expect(def.id).toBe('dev-x');
        expect(def.snapshot.lock).toBe(lock);
    });
});

describe('失敗の後に何を残し、何をやり直すか', () => {
    it('初回のビルドが失敗しても mod は監視の対象に入り、直して知らせれば公開される', async () => {
        const h = harness({ loadWorld: async () => undefined });
        h.compile.mockRejectedValueOnce(new Error('syntax error'));
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)).toBeUndefined();
        // 監視の情報は公開の成否と切り離されている（ここが空だと、直して保存しても気づけない）
        expect([...h.pipeline.modDirs.keys()]).toEqual(['pen']);
        // 直した: 監視が pen の変更を知らせる
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)).toMatchObject({ buildId: 'r-1', instanceId: 'dev-r-1' });
        expect(h.go.puts.map((d) => d.id)).toEqual(['dev-r-1']);
    });

    it('A と B を同時に変えて B だけ失敗し、B を直したとき、A の変更も次の世代に入る', async () => {
        const h2 = harness({ loadWorld: async () => worldYaml(['pen', 'danmaku']) });
        h2.mods.set('danmaku', fakeMod('danmaku'));
        h2.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h2.pipeline.idle();
        const firstPen = currentGeneration(h2.pipeline.state)?.mods.get('pen');

        // A（pen）を変え、B（danmaku）を壊す
        const penV2 = edited(fakeMod('pen'), 'C');
        h2.mods.set('pen', penV2);
        h2.compile.mockImplementation(async (dir: string) => {
            if (dir.endsWith('danmaku')) throw new Error('broken danmaku');
            return h2.mods.get(dir.split('/').pop() as string) as ModArtifacts;
        });
        h2.pipeline.schedule({ mods: new Set(['pen', 'danmaku']), reconfigure: false });
        await h2.pipeline.idle();
        expect(currentGeneration(h2.pipeline.state)?.mods.get('pen')).toBe(firstPen);
        expect(lastDiagnostics(h2.events)).toEqual([{ kind: 'build', mod: 'danmaku', message: 'broken danmaku' }]);

        // B だけを直して保存する（監視が知らせるのは danmaku だけ）
        h2.compile.mockImplementation(
            async (dir: string) => h2.mods.get(dir.split('/').pop() as string) as ModArtifacts,
        );
        h2.pipeline.schedule({ mods: new Set(['danmaku']), reconfigure: false });
        await h2.pipeline.idle();
        expect(currentGeneration(h2.pipeline.state)?.mods.get('pen')).toBe(penV2);
        expect(lastDiagnostics(h2.events)).toEqual([]);
    });

    it('失敗の後、次の知らせが来るまでは同じビルドを繰り返さない', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.compile.mockRejectedValue(new Error('still broken'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        await h.pipeline.idle();
        expect(h.compile).toHaveBeenCalledTimes(2);
    });

    it('失敗した mod はすべて知らせる（1 つ目で止めない）', async () => {
        const h = harness({ loadWorld: async () => undefined });
        h.mods.set('danmaku', fakeMod('danmaku'));
        h.compile.mockRejectedValue(new Error('broken'));
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        expect(
            lastDiagnostics(h.events)
                ?.map((f) => (f.kind === 'build' ? f.mod : f.kind))
                .sort(),
        ).toEqual(['danmaku', 'pen']);
    });

    it('合成したワールドに同じ版のまま Worker を足すと、部屋を作り直して新しい Component が入る', async () => {
        const h = harness({ loadWorld: async () => undefined });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.mods.set('pen', fakeMod('pen', '1.0.0', ['pen:main', 'pen:tray']));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.instanceId).toBe('dev-r-2');
        expect(
            h.go.puts
                .at(-1)
                ?.snapshot.entities.filter((e) => e.type !== EMPTY_ENTITY_TYPE)
                .map((e) => e.type),
        ).toEqual(['pen:main', 'pen:tray']);
    });

    it('部屋の作り直しを Go が断ったら、作り直しの要求は残り、次の変更のときにもう一度試す', async () => {
        const reject = { on: false };
        const go = fakeGo(() => (reject.on ? 'busy' : null));
        const h = harness({ go: () => go.admin });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        reject.on = true;
        h.pipeline.schedule({ mods: new Set(), reconfigure: true });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.instanceId).toBe('dev-r-1');
        reject.on = false;
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.instanceId).toBe('dev-r-2');
    });
});

describe('診断', () => {
    it('壊して元に戻した（中身が公開中と同じで公開しない）ときも、診断を空にして知らせる', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.compile.mockRejectedValueOnce(new Error('broken'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(h.pipeline.diagnostics).toHaveLength(1);
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.buildId).toBe('r-1');
        expect(h.pipeline.diagnostics).toEqual([]);
        expect(h.events.at(-1)).toEqual({ type: 'diagnostics', failures: [] });
    });

    it('同じ失敗が続いても送り直さない', async () => {
        const h = harness();
        h.compile.mockRejectedValue(new Error('broken'));
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(h.events.filter((e) => e.type === 'diagnostics')).toHaveLength(1);
    });
});

describe('手元に無い mod', () => {
    /** pen は手元、video-player は source.url の置き場所にある。 */
    const withRemote = (lock?: WorldSource['lock']) => {
        const world = worldYaml(['pen', 'video-player']);
        const spec = (world.raw as { spec: { dependencies: { name: string; source: object }[] } }).spec;
        spec.dependencies[1] = { name: 'video-player', source: { url: 'https://vp.example', version: 'latest' } };
        return { ...world, ...(lock ? { lock } : {}) };
    };

    it('world.yaml を作り直すときだけ外へ取りに行き、手元の mod の保存では前の世代の版を使う', async () => {
        const remote = remoteMods({ 'video-player': fakeMod('video-player', '4.0.0') });
        const h = harness({ loadWorld: async () => withRemote(), fetchImpl: remote.fetchImpl });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.lock.mods['video-player']).toMatchObject({
            version: '4.0.0',
            baseUrl: 'https://vp.example',
        });
        const fetchedAtStart = remote.fetched.length;
        expect(fetchedAtStart).toBeGreaterThan(0);

        h.mods.set('pen', edited(fakeMod('pen'), 'D'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.buildId).toBe('r-2');
        expect(currentGeneration(h.pipeline.state)?.lock.mods['video-player']?.version).toBe('4.0.0');
        expect(remote.fetched).toHaveLength(fetchedAtStart);

        h.pipeline.schedule({ mods: new Set(), reconfigure: true });
        await h.pipeline.idle();
        expect(remote.fetched.length).toBeGreaterThan(fetchedAtStart);
    });

    it('world.yaml の横の lock があれば、外の mod はその版（本番と同じ）で、取りに行かない', async () => {
        const remote = remoteMods({ 'video-player': fakeMod('video-player', '4.0.0') });
        const pinned = {
            lockVersion: 1 as const,
            mods: { 'video-player': { ...fakeMod('video-player', '3.1.0').lockEntry, baseUrl: 'https://vp.example' } },
        };
        const logs: string[] = [];
        const h = harness({
            loadWorld: async () => withRemote(pinned),
            fetchImpl: remote.fetchImpl,
            log: (line) => logs.push(line),
        });
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.lock.mods['video-player']?.version).toBe('3.1.0');
        expect(remote.fetched).toEqual([]);
        expect(logs.join('\n')).toContain('video-player@3.1.0（lock）');
    });
});

describe('中身の変わらない保存', () => {
    it('ビルドし直しても成果物が同じなら、新しい世代を公開しない（ページを読み直させない）', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.buildId).toBe('r-1');
        expect(h.events.filter((e) => e.type === 'generation')).toHaveLength(1);
        // 部屋を作り直すボタンは中身が同じでも効く
        h.pipeline.schedule({ mods: new Set(), reconfigure: true });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.instanceId).toBe('dev-r-2');
    });
});

/** dataFields を manifest に持つ mod（version と Component は fakeMod と同じ。manifest の中身だけ変える）。 */
const withFields = (base: ModArtifacts, components: Record<string, unknown>, mark: string): ModArtifacts => ({
    ...edited(base, mark),
    files: new Map([['manifest.json', new TextEncoder().encode(JSON.stringify({ components }))]]),
});
const VP_TYPES = ['vp:controls', 'vp:screen'];
const REQUIRED_SCREEN = {
    'vp:controls': {
        dataFields: { screen: { type: 'entityRef', component: 'vp:screen', required: true, label: 'スクリーン' } },
    },
};

describe('参照の宣言の変化（#297 のレビュー）', () => {
    it('起動後に必須の参照を宣言して保存すると、合成ワールドの部屋を作り直して配線する（版と Component は同じ）', async () => {
        const h = harness({ loadWorld: async () => undefined });
        h.mods.clear();
        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), {}, 'A'));
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        expect(JSON.stringify(h.go.puts[0])).not.toContain('"screen"');

        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), REQUIRED_SCREEN, 'B'));
        h.pipeline.schedule({ mods: new Set(['vp']), reconfigure: false });
        await h.pipeline.idle();
        expect(h.go.puts).toHaveLength(2);
        expect(JSON.stringify(h.go.puts[1])).toContain('"screen":"vp--screen"');
        expect(h.pipeline.diagnostics.filter((d) => d.kind === 'reference')).toEqual([]);
    });

    it('合成の結果が変わらない保存（コードだけの変更）では部屋を作り直さない', async () => {
        const h = harness({ loadWorld: async () => undefined });
        h.mods.clear();
        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), REQUIRED_SCREEN, 'A'));
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), REQUIRED_SCREEN, 'B'));
        h.pipeline.schedule({ mods: new Set(['vp']), reconfigure: false });
        await h.pipeline.idle();
        expect(h.go.puts).toHaveLength(1);
    });

    it('world.yaml のワールドでも、部屋を作り直さないビルドで参照を検査して知らせる（同じ問題はターミナルに出し直さない）', async () => {
        const logs: string[] = [];
        const world: WorldSource = {
            url: 'file:///p/world.yaml',
            raw: {
                apiVersion: 'ubichill.com/v1alpha1',
                kind: 'World',
                metadata: { name: 'home', version: '1.0.0' },
                spec: {
                    displayName: 'Home',
                    dependencies: [{ name: 'vp', source: { version: 'latest' } }],
                    initialEntities: [{ id: 'c', transform: { x: 0, y: 0 }, components: [{ type: 'vp:controls' }] }],
                },
            },
        };
        const h = harness({ loadWorld: async () => world, log: (line) => logs.push(line) });
        h.mods.clear();
        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), {}, 'A'));
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        expect(h.pipeline.diagnostics).toEqual([]);

        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), REQUIRED_SCREEN, 'B'));
        h.pipeline.schedule({ mods: new Set(['vp']), reconfigure: false });
        await h.pipeline.idle();
        expect(h.go.puts).toHaveLength(1);
        const warning = 'c の vp:controls の「スクリーン」が未設定です。vp:screen を持つ Entity を指定してください';
        expect(h.pipeline.diagnostics).toEqual([{ kind: 'reference', message: warning }]);
        expect(lastDiagnostics(h.events)).toEqual([{ kind: 'reference', message: warning }]);

        h.mods.set('vp', withFields(fakeMod('vp', '1.0.0', VP_TYPES), REQUIRED_SCREEN, 'C'));
        h.pipeline.schedule({ mods: new Set(['vp']), reconfigure: false });
        await h.pipeline.idle();
        expect(logs.filter((l) => l.startsWith('参照の問題'))).toEqual([`参照の問題: ${warning}`]);
    });
});
