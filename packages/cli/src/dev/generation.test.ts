import { describe, expect, it } from 'vitest';
import type { ModArtifacts } from '../build.ts';
import {
    buildGenerationLock,
    currentGeneration,
    externalLockEntries,
    findGeneration,
    type Generation,
    generationModsBase,
    initialGenerationState,
    KEEP_GENERATIONS,
    needsNewRoom,
    nextBuildId,
    publishGeneration,
    reuseExternalEntries,
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

/** `<url>/<mod>/mod.json` と `<url>/<mod>/v<ver>/lock.json` を返す置き場所。取りに来た URL を記録する。 */
export function remoteMods(entries: Record<string, ModArtifacts>) {
    const fetched: string[] = [];
    const fetchImpl = async (input: string) => {
        fetched.push(input);
        const [, modId, file] = input.match(/\/([^/]+)\/(mod\.json|v[^/]+\/lock\.json)$/) ?? [];
        const mod = modId ? entries[modId] : undefined;
        const body = mod && (file === 'mod.json' ? { version: mod.version } : mod.lockEntry);
        return {
            ok: Boolean(body),
            status: body ? 200 : 404,
            headers: { get: () => null },
            json: async () => body,
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
        };
    };
    return { fetched, fetchImpl };
}
const none = async () => null;

describe('buildGenerationLock', () => {
    it('手元の mod の lock に世代の baseUrl を付け、取れない mod は lock に入れない', async () => {
        const mods = new Map([['pen', fakeMod('pen', '2.0.0')]]);
        const lock = await buildGenerationLock('r-1', mods, ['pen', 'missing'], none);
        expect(Object.keys(lock.mods)).toEqual(['pen']);
        expect(lock.mods.pen?.baseUrl).toBe(generationModsBase('r-1'));
        expect(lock.mods.pen?.version).toBe('2.0.0');
    });

    it('source.url に置き場所が書いてあっても、手元でビルドした mod を使う（作業中のコードが動く）', async () => {
        const remote = remoteMods({ pen: fakeMod('pen', '9.9.9') });
        const dependencies = [{ name: 'pen', source: { url: 'https://cdn.example/mods', version: 'latest' as const } }];
        const lock = await buildGenerationLock(
            'r-1',
            new Map([['pen', fakeMod('pen')]]),
            ['pen'],
            externalLockEntries(dependencies, undefined, remote.fetchImpl),
        );
        expect(lock.mods.pen).toMatchObject({ version: '1.0.0', baseUrl: generationModsBase('r-1') });
        expect(remote.fetched).toEqual([]);
    });
});

describe('externalLockEntries', () => {
    const dependencies = [
        { name: 'video-player', source: { url: 'https://vp.example', version: 'latest' as const } },
        { name: 'pen', source: { url: 'https://pen.example', version: 'latest' as const } },
    ];
    const pinned = {
        lockVersion: 1 as const,
        mods: { 'video-player': { ...fakeMod('video-player', '3.1.0').lockEntry, baseUrl: 'https://vp.example' } },
    };

    it('world.yaml の横の lock にある mod はその版（本番と同じ）、無い mod だけ source.url の最新を取る', async () => {
        const remote = remoteMods({ 'video-player': fakeMod('video-player', '4.0.0'), pen: fakeMod('pen', '1.2.0') });
        const lock = await buildGenerationLock(
            'r-1',
            new Map(),
            ['video-player', 'pen'],
            externalLockEntries(dependencies, pinned, remote.fetchImpl),
        );
        expect(lock.mods['video-player']?.version).toBe('3.1.0');
        expect(lock.mods.pen).toMatchObject({ version: '1.2.0', baseUrl: 'https://pen.example' });
        expect(remote.fetched.every((url) => url.startsWith('https://pen.example/'))).toBe(true);
    });

    it('lock の版が source.version の固定と違えば古い lock なので使わず、固定の版を取る', async () => {
        const remote = remoteMods({ 'video-player': fakeMod('video-player', '3.2.0') });
        const fixed = [{ name: 'video-player', source: { url: 'https://vp.example', version: '3.2.0' } }];
        const entry = await externalLockEntries(fixed, pinned, remote.fetchImpl)('video-player');
        expect(entry?.version).toBe('3.2.0');
        expect(remote.fetched).toEqual(['https://vp.example/video-player/v3.2.0/lock.json']);
    });

    it('置き場所が相対・無しの lock の entry は dev から取れないので使わない', async () => {
        const local = { lockVersion: 1 as const, mods: { pen: { ...fakeMod('pen').lockEntry, baseUrl: undefined } } };
        expect(await externalLockEntries([], local)('pen')).toBeNull();
    });
});

describe('reuseExternalEntries', () => {
    it('前の世代が外から取った mod は取り直さず、前の世代の手元のビルド（相対の baseUrl）は使わない', async () => {
        const previous: Generation = {
            ...gen('r-1'),
            lock: {
                lockVersion: 1,
                mods: {
                    'video-player': { ...fakeMod('video-player').lockEntry, baseUrl: 'https://vp.example' },
                    pen: { ...fakeMod('pen').lockEntry, baseUrl: generationModsBase('r-1') },
                },
            },
        };
        const asked: string[] = [];
        const getter = reuseExternalEntries(previous, async (modId) => {
            asked.push(modId);
            return null;
        });
        expect((await getter('video-player'))?.baseUrl).toBe('https://vp.example');
        expect(await getter('pen')).toBeNull();
        expect(asked).toEqual(['pen']);
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
