import { createHash } from 'node:crypto';
import type { Dependency, InitialEntity, ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    buildWorldLock,
    collectModIds,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
    resolveLatestVersion,
} from './buildWorldLock';
import type { FetchLike, FetchLikeResponse } from './types';

/** テスト用 Entity（transform は最小）。 */
function entity(id: string, types: string[], children: InitialEntity[] = []): InitialEntity {
    return {
        id,
        transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
        components: types.map((type) => ({ type, data: {} })),
        tags: [],
        children,
    };
}

function sri(text: string): string {
    return `sha256-${createHash('sha256').update(text).digest('base64')}`;
}

function lockEntry(id: string): ModLockEntry {
    return { id, version: '1.0.0', manifestIntegrity: sri(id), components: {} };
}

describe('collectModIds', () => {
    it('子孫を含めて modId を重複なく集める', () => {
        const tree = [
            entity('a', ['pen:pen', 'pen:tray'], [entity('b', ['video-player:screen'])]),
            entity('c', ['pen:canvas']),
        ];
        expect(collectModIds(tree).sort()).toEqual(['pen', 'video-player']);
    });

    it('コロンを含まない不正 type は modId 側（先頭）を拾う（防御的）', () => {
        // ComponentType はスキーマ上 "mod:name" 形式だが、split 実装の堅牢性を確認。
        expect(collectModIds([entity('a', ['solo'])])).toEqual(['solo']);
    });

    it('空ツリーは空配列', () => {
        expect(collectModIds([])).toEqual([]);
    });
});

describe('buildWorldLock', () => {
    it('取得できた mod だけを lock.mods に載せ、取得不能は除外する', async () => {
        const getter = async (id: string) => (id === 'pen' ? lockEntry('pen') : null);
        const lock = await buildWorldLock(['pen', 'ghost'], getter);
        expect(lock.lockVersion).toBe(1);
        expect(Object.keys(lock.mods)).toEqual(['pen']);
        expect(lock.mods.pen.id).toBe('pen');
    });

    it('全 mod が取得不能なら空 lock（外部公開時は読む側で lock-missing 拒否）', async () => {
        const lock = await buildWorldLock(['a', 'b'], async () => null);
        expect(lock.mods).toEqual({});
    });
});

/** テスト用の fetch モック。`routes` に無い URL は 404 を返す。 */
function fakeFetch(routes: Record<string, unknown>): FetchLike {
    return (async (url: string) => {
        const body = routes[url];
        const ok = body !== undefined;
        return {
            ok,
            headers: { get: () => null },
            json: async () => body,
            text: async () => JSON.stringify(body),
            arrayBuffer: async () => new ArrayBuffer(0),
        } satisfies FetchLikeResponse;
    }) as FetchLike;
}

describe('resolveLatestVersion', () => {
    it('mod.json の version を返す', async () => {
        const f = fakeFetch({ 'https://cdn.test/pen/mod.json': { id: 'pen', version: '3.0.0' } });
        expect(await resolveLatestVersion('https://cdn.test', 'pen', f)).toBe('3.0.0');
    });

    it('取得不能なら null', async () => {
        const f = fakeFetch({});
        expect(await resolveLatestVersion('https://cdn.test', 'ghost', f)).toBeNull();
    });
});

describe('createHttpLockEntryGetter (pinned version)', () => {
    it('pinnedVersion 指定時は mod.json を経由せず直接そのバージョンの lock.json を取得する', async () => {
        const calls: string[] = [];
        const f: FetchLike = (async (url: string) => {
            calls.push(url);
            if (url === 'https://cdn.test/pen/v1.0.0/lock.json') {
                return {
                    ok: true,
                    headers: { get: () => null },
                    json: async () => lockEntry('pen'),
                    text: async () => '',
                    arrayBuffer: async () => new ArrayBuffer(0),
                } satisfies FetchLikeResponse;
            }
            return {
                ok: false,
                headers: { get: () => null },
                json: async () => null,
                text: async () => '',
                arrayBuffer: async () => new ArrayBuffer(0),
            };
        }) as FetchLike;

        const entry = await createHttpLockEntryGetter('https://cdn.test', f)('pen', '1.0.0');
        expect(entry?.id).toBe('pen');
        expect(calls).toEqual(['https://cdn.test/pen/v1.0.0/lock.json']);
    });

    it('pinnedVersion 未指定時は mod.json（最新ポインタ）経由で解決する（従来挙動）', async () => {
        const f = fakeFetch({
            'https://cdn.test/pen/mod.json': { id: 'pen', version: '1.0.0' },
            'https://cdn.test/pen/v1.0.0/lock.json': lockEntry('pen'),
        });
        const entry = await createHttpLockEntryGetter('https://cdn.test', f)('pen');
        expect(entry?.id).toBe('pen');
    });
});

describe('createDependencyAwareLockEntryGetter', () => {
    function dep(name: string, source: Dependency['source']): Dependency {
        return { name, source };
    }

    it('type: url の依存は source.url から個別取得し baseUrl を焼き込む', async () => {
        const f = fakeFetch({
            'https://cdn.example.test/video-player/mod.json': { id: 'video-player', version: '2.0.0' },
            'https://cdn.example.test/video-player/v2.0.0/lock.json': lockEntry('video-player'),
        });
        const dependencies = [dep('video-player', { type: 'url', url: 'https://cdn.example.test' })];
        const fallback = async () => null;
        const getter = createDependencyAwareLockEntryGetter(dependencies, fallback, f);

        const entry = await getter('video-player');
        expect(entry?.baseUrl).toBe('https://cdn.example.test');
    });

    it('source.version が pin されている mod は fallbackGetter にそのバージョンを渡す', async () => {
        const dependencies = [dep('pen', { type: 'local', version: '1.2.3' })];
        const seen: Array<string | undefined> = [];
        const fallback = async (id: string, version?: string) => {
            seen.push(version);
            return id === 'pen' ? lockEntry('pen') : null;
        };
        const getter = createDependencyAwareLockEntryGetter(dependencies, fallback);

        await getter('pen');
        expect(seen).toEqual(['1.2.3']);
    });

    it('依存に載っていない mod は fallbackGetter にそのまま委譲する（version 未指定）', async () => {
        const seen: Array<string | undefined> = [];
        const fallback = async (id: string, version?: string) => {
            seen.push(version);
            return lockEntry(id);
        };
        const getter = createDependencyAwareLockEntryGetter([], fallback);

        await getter('pen');
        expect(seen).toEqual([undefined]);
    });
});
