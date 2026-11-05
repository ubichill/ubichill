/**
 * 世代を確定する順序。失敗した段階で何が残るかは docs/design/world-runtime-dev.md の表の通り。
 */
import type { InstanceDefinition } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ModArtifacts } from '../build.ts';
import { fakeMod } from './generation.test.ts';
import { currentGeneration, initialGenerationState } from './generation.ts';
import type { GoAdmin } from './goRuntime.ts';
import { buildRoomDefinition, createPipeline, type PipelineDeps, type WorldSource } from './pipeline.ts';
import type { DevEvent } from './server.ts';

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

    it('ビルドに失敗したら前の世代と部屋のまま、build-error だけを送る', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        h.compile.mockRejectedValueOnce(new Error('syntax error in pen.worker.tsx'));
        h.pipeline.schedule({ mods: new Set(['pen']), reconfigure: false });
        await h.pipeline.idle();
        expect(currentGeneration(h.pipeline.state)?.buildId).toBe('r-1');
        expect(h.events.at(-1)).toEqual({ type: 'build-error', mod: 'pen', message: 'syntax error in pen.worker.tsx' });
        expect(h.go.puts).toHaveLength(1);
        expect(h.go.deletes).toEqual([]);
    });

    it('world.yaml が壊れている・lock に無い mod を参照していると world-error で止まり、Go には送らない', async () => {
        const broken = harness({ loadWorld: async () => ({ url: 'file:///p/world.yaml', raw: { kind: 'World' } }) });
        broken.pipeline.schedule({ mods: 'all', reconfigure: true });
        await broken.pipeline.idle();
        expect(currentGeneration(broken.pipeline.state)).toBeUndefined();
        expect(broken.events.at(-1)).toMatchObject({ type: 'world-error', message: expect.stringContaining('無効') });
        expect(broken.go.puts).toEqual([]);

        const missing = harness({ loadWorld: async () => worldYaml(['pen', 'ghost']) });
        missing.pipeline.schedule({ mods: 'all', reconfigure: true });
        await missing.pipeline.idle();
        expect(missing.events.at(-1)).toMatchObject({ type: 'world-error', message: expect.stringContaining('ghost') });
        expect(missing.go.puts).toEqual([]);
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
        expect(h2.events.at(-1)).toMatchObject({ type: 'world-error', message: expect.stringContaining('too large') });
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
        expect(put?.snapshot.entities.map((e) => e.type)).toEqual(['pen:main']);
        expect(put?.snapshot.activeMods).toEqual(['pen']);
    });

    it('Go が起動し直したら今の部屋を作り直す', async () => {
        const h = harness();
        h.pipeline.schedule({ mods: 'all', reconfigure: true });
        await h.pipeline.idle();
        await h.pipeline.restoreRoom();
        expect(h.go.puts.map((d) => d.id)).toEqual(['dev-r-1', 'dev-r-1']);
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
        expect(h2.events.at(-1)).toMatchObject({ type: 'build-error', mod: 'danmaku' });

        // B だけを直して保存する（監視が知らせるのは danmaku だけ）
        h2.compile.mockImplementation(
            async (dir: string) => h2.mods.get(dir.split('/').pop() as string) as ModArtifacts,
        );
        h2.pipeline.schedule({ mods: new Set(['danmaku']), reconfigure: false });
        await h2.pipeline.idle();
        expect(currentGeneration(h2.pipeline.state)?.mods.get('pen')).toBe(penV2);
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
            h.events
                .filter((e) => e.type === 'build-error')
                .map((e) => (e as { mod: string }).mod)
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
        expect(h.go.puts.at(-1)?.snapshot.entities.map((e) => e.type)).toEqual(['pen:main', 'pen:tray']);
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
