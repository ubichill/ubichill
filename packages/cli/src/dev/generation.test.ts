import { describe, expect, it } from 'vitest';
import type { ModArtifacts } from '../build.ts';
import {
    buildGenerationLock,
    currentGeneration,
    findGeneration,
    type Generation,
    generationModsBase,
    initialGenerationState,
    KEEP_GENERATIONS,
    needsNewRoom,
    nextBuildId,
    publishGeneration,
} from './generation.ts';

const integrity = `sha256-${'A'.repeat(43)}=`;
export const fakeMod = (id: string, version = '1.0.0', components: string[] = [`${id}:main`]): ModArtifacts => ({
    id,
    name: id,
    version,
    components,
    files: new Map([['manifest.json', new TextEncoder().encode('{}')]]),
    lockEntry: {
        id,
        version,
        manifestIntegrity: integrity,
        components: Object.fromEntries(
            components.map((type) => [type, { workerUrl: './main/index.00000000.js', integrity, capabilities: [] }]),
        ),
    },
    inputs: new Set([`/mods/${id}/package.json`]),
});
const gen = (buildId: string, mods: ModArtifacts[] = [fakeMod('pen')], instanceId = `dev-${buildId}`): Generation => ({
    buildId,
    mods: new Map(mods.map((m) => [m.id, m])),
    lock: { lockVersion: 1, mods: {} },
    instanceId,
});

describe('buildId', () => {
    it('起動ごとの乱数と連番で、作った順に並び、再起動した dev サーバーと衝突しない', () => {
        const a = nextBuildId(initialGenerationState('run1'));
        const b = nextBuildId(a.state);
        expect([a.buildId, b.buildId]).toEqual(['run1-1', 'run1-2']);
        expect(nextBuildId(initialGenerationState('run2')).buildId).toBe('run2-1');
    });
});

describe('publishGeneration', () => {
    it('先頭が今の世代で、直近 3 つだけ残す。消えた世代は引けない', () => {
        const state = ['a', 'b', 'c', 'd'].reduce(
            (s, id) => publishGeneration(s, gen(id)),
            initialGenerationState('r'),
        );
        expect(state.kept.map((g) => g.buildId)).toEqual(['d', 'c', 'b']);
        expect(state.kept).toHaveLength(KEEP_GENERATIONS);
        expect(currentGeneration(state)?.buildId).toBe('d');
        expect(findGeneration(state, 'b')?.buildId).toBe('b');
        expect(findGeneration(state, 'a')).toBeUndefined();
    });
});

describe('buildGenerationLock', () => {
    it('手元の mod の lock に世代の baseUrl を付け、無い mod は lock に入れない', async () => {
        const mods = new Map([['pen', fakeMod('pen', '2.0.0')]]);
        const lock = await buildGenerationLock('r-1', mods, ['pen', 'missing'], undefined);
        expect(Object.keys(lock.mods)).toEqual(['pen']);
        expect(lock.mods.pen?.baseUrl).toBe(generationModsBase('r-1'));
        expect(lock.mods.pen?.version).toBe('2.0.0');
    });

    it('dependencies に source.url がある mod はその置き場所から取る（手元より優先）', async () => {
        const fetched: string[] = [];
        const fetchImpl = async (input: string) => {
            fetched.push(input);
            return {
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: async () => fakeMod('pen', '9.9.9').lockEntry,
                text: async () => '',
                arrayBuffer: async () => new ArrayBuffer(0),
            };
        };
        const lock = await buildGenerationLock(
            'r-1',
            new Map([['pen', fakeMod('pen')]]),
            ['pen'],
            [{ name: 'pen', source: { url: 'https://cdn.example/mods', version: '9.9.9' } }],
            fetchImpl,
        );
        expect(fetched).toEqual(['https://cdn.example/mods/pen/v9.9.9/lock.json']);
        expect(lock.mods.pen?.baseUrl).toBe('https://cdn.example/mods');
    });
});

describe('needsNewRoom', () => {
    const yaml = { synthesized: false };
    it('最初・mod の集合が変わった・版が変わったときだけ部屋を作り直す', () => {
        const previous = gen('r-1', [fakeMod('pen'), fakeMod('danmaku')]);
        expect(needsNewRoom(undefined, previous.mods, yaml)).toBe(true);
        expect(
            needsNewRoom(
                previous,
                new Map([
                    ['pen', fakeMod('pen')],
                    ['danmaku', fakeMod('danmaku')],
                ]),
                yaml,
            ),
        ).toBe(false);
        expect(
            needsNewRoom(
                previous,
                new Map([
                    ['pen', fakeMod('pen', '1.0.1')],
                    ['danmaku', fakeMod('danmaku')],
                ]),
                yaml,
            ),
        ).toBe(true);
        expect(needsNewRoom(previous, new Map([['pen', fakeMod('pen')]]), yaml)).toBe(true);
        expect(
            needsNewRoom(
                previous,
                new Map([
                    ['pen', fakeMod('pen')],
                    ['other', fakeMod('other')],
                ]),
                yaml,
            ),
        ).toBe(true);
    });
});

describe('needsNewRoom（Component の増減）', () => {
    const previous = gen('r-1', [fakeMod('pen', '1.0.0', ['pen:pen'])]);
    const added = new Map([['pen', fakeMod('pen', '1.0.0', ['pen:pen', 'pen:tray'])]]);
    it('合成したワールドでは、同じ版のまま Worker を足しても部屋を作り直す（新しい Component の entity が要る）', () => {
        expect(needsNewRoom(previous, added, { synthesized: true })).toBe(true);
        const reordered = new Map([['pen', fakeMod('pen', '1.0.0', ['pen:pen'])]]);
        expect(needsNewRoom(previous, reordered, { synthesized: true })).toBe(false);
    });
    it('world.yaml のワールドは配置が YAML で決まるので、Component の増減だけでは作り直さない', () => {
        expect(needsNewRoom(previous, added, { synthesized: false })).toBe(false);
    });
});
