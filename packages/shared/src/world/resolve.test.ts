import { describe, expect, it } from 'vitest';
import { WorldSourceKind } from '../schemas/world.schema';
import {
    definitionToResolved,
    migrateLegacyWorldYaml,
    parseStoredDefinition,
    validateWorldDefinition,
} from './resolve';

const url = 'https://example.com/w.yaml';
const source = { kind: WorldSourceKind.Url, url } as const;

const definition = (spec: Record<string, unknown> = {}) => ({
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    metadata: { name: 'test-world', version: '1.2.3', author: { name: 'Alice' } },
    spec: { displayName: 'テスト', capacity: { default: 8, max: 16 }, initialEntities: [], ...spec },
});

describe('migrateLegacyWorldYaml', () => {
    it('旧形式（kind + data）を id + components にし、同じ kind は連番で id を分ける', () => {
        const migrated = migrateLegacyWorldYaml(
            definition({
                initialEntities: [
                    { kind: 'pen:tray', transform: { x: 0, y: 0 } },
                    { kind: 'pen:tray', transform: { x: 1, y: 1 }, data: { a: 1 } },
                    { id: 'kept', transform: { x: 2, y: 2 }, components: [] },
                ],
            }),
        ) as { spec: { initialEntities: Array<{ id: string; components: Array<{ type: string; data: unknown }> }> } };
        expect(migrated.spec.initialEntities.map((e) => e.id)).toEqual(['pen-tray', 'pen-tray-2', 'kept']);
        expect(migrated.spec.initialEntities[1]?.components).toEqual([{ type: 'pen:tray', data: { a: 1 } }]);
    });

    it('旧形式が混ざっていなければ同じ値を返す（新形式を組み直さない）', () => {
        const parsed = definition({ initialEntities: [{ id: 'a', transform: { x: 0, y: 0 }, components: [] }] });
        expect(migrateLegacyWorldYaml(parsed)).toBe(parsed);
        expect(migrateLegacyWorldYaml(null)).toBeNull();
        expect(migrateLegacyWorldYaml({ spec: 'x' })).toEqual({ spec: 'x' });
    });

    it('子階層の旧形式も、ツリー全体で id が衝突しないように採番する', () => {
        const migrated = migrateLegacyWorldYaml(
            definition({
                initialEntities: [
                    {
                        id: 'parent',
                        transform: { x: 0, y: 0 },
                        components: [],
                        children: [{ kind: 'pen:pen', transform: { x: 0, y: 0 } }],
                    },
                    { kind: 'pen:pen', transform: { x: 0, y: 0 } },
                ],
            }),
        ) as { spec: { initialEntities: Array<{ id: string; children: Array<{ id: string }> }> } };
        expect(migrated.spec.initialEntities[0]?.children[0]?.id).toBe('pen-pen');
        expect(migrated.spec.initialEntities[1]?.id).toBe('pen-pen-2');
    });
});

describe('validateWorldDefinition / parseStoredDefinition', () => {
    it('不正な定義は URL 付きの例外になり、parseStoredDefinition は undefined', () => {
        expect(() => validateWorldDefinition({ kind: 'World' }, url)).toThrow(url);
        expect(parseStoredDefinition({ kind: 'World' })).toBeUndefined();
    });

    it('旧形式の保存データも読める', () => {
        const def = parseStoredDefinition(
            definition({ initialEntities: [{ kind: 'pen:tray', transform: { x: 0, y: 0 } }] }),
        );
        expect(def?.spec.initialEntities[0]?.components[0]?.type).toBe('pen:tray');
    });
});

describe('definitionToResolved', () => {
    it('url・source・作者名・定員を写し、environment は既定値を補う', () => {
        const resolved = definitionToResolved(definition({ environment: { backgroundColor: '#123456' } }), url, source);
        expect(resolved).toMatchObject({
            url,
            source,
            id: 'test-world',
            version: '1.2.3',
            displayName: 'テスト',
            authorName: 'Alice',
            capacity: { default: 8, max: 16 },
            environment: { backgroundColor: '#123456', worldSize: { width: 2000, height: 1500 } },
        });
    });

    it('component 型と dependencies から mods を重複なく集める（dependency の版が付く）', () => {
        const resolved = definitionToResolved(
            definition({
                dependencies: [{ name: 'avatar', source: { type: 'url', url: 'https://x/avatar' } }],
                initialEntities: [
                    {
                        id: 'a',
                        transform: { x: 0, y: 0 },
                        components: [{ type: 'pen:tray' }, { type: 'pen:pen' }],
                        children: [
                            { id: 'b', transform: { x: 0, y: 0 }, components: [{ type: 'video-player:screen' }] },
                        ],
                    },
                ],
            }),
            url,
            source,
        );
        expect(resolved.mods.map((m) => m.id).sort()).toEqual(['avatar', 'pen', 'video-player']);
        expect(resolved.mods.find((m) => m.id === 'avatar')?.version).toBe('latest');
    });

    it('別配信の lock を埋め込みより優先し、extra の authorId・identity を写す', () => {
        const embedded = { lockVersion: 1 as const, mods: {} };
        const sibling = {
            lockVersion: 1 as const,
            mods: {
                pen: { id: 'pen', version: '1.0.0', manifestIntegrity: `sha256-${'A'.repeat(43)}=`, components: {} },
            },
        };
        const withSibling = definitionToResolved(definition({ lock: embedded }), url, source, {
            lock: sibling,
            authorId: 'user-1',
        });
        expect(withSibling.lock).toBe(sibling);
        expect(withSibling.authorId).toBe('user-1');
        expect(definitionToResolved(definition({ lock: embedded }), url, source).lock).toEqual(embedded);
    });

    it('Component の省略可能フィールド（id / transform 上書き / overlay）を正規化で落とさない', () => {
        const [ship] = definitionToResolved(
            definition({
                initialEntities: [
                    {
                        id: 'ship',
                        transform: { x: 0, y: 0 },
                        components: [
                            {
                                id: 'pad',
                                type: 'mobile-controller:controller',
                                overlay: 'bottom-left',
                                transform: { x: 24, y: 24, w: 240, h: 140 },
                            },
                            { type: 'pen:tray', overlay: true },
                            { type: 'danmaku:wall' },
                        ],
                        children: [
                            {
                                id: 'child',
                                transform: { x: 0, y: 0 },
                                components: [{ type: 'pen:pen', overlay: 'top-right' }],
                            },
                        ],
                    },
                ],
            }),
            url,
            source,
        ).initialEntities;
        expect(ship?.components[0]).toMatchObject({
            id: 'pad',
            overlay: 'bottom-left',
            transform: { x: 24, y: 24, w: 240, h: 140 },
        });
        expect(ship?.components[1]?.overlay).toBe(true);
        expect(ship?.components[2]?.overlay).toBeUndefined();
        expect(ship?.children[0]?.components[0]?.overlay).toBe('top-right');
    });
});
