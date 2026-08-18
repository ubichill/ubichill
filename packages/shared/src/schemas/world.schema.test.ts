import { describe, expect, it } from 'vitest';
import {
    collectModIds,
    DependencySourceSchema,
    InitialEntitiesSchema,
    type InitialEntity,
    type WorldSource,
    WorldSourceKind,
    worldOriginDomain,
} from './world.schema';

describe('worldOriginDomain', () => {
    it('ローカルは null（何も出さない）', () => {
        const s: WorldSource = { kind: WorldSourceKind.Local, url: 'https://me.example/api/v1/worlds/w1' };
        expect(worldOriginDomain(s)).toBeNull();
    });

    it('リモートインスタンスは originInstance の host を返す', () => {
        const s: WorldSource = {
            kind: WorldSourceKind.RemoteInstance,
            url: 'https://peer.example/api/v1/worlds/w1',
            originInstance: 'https://peer.example',
        };
        expect(worldOriginDomain(s)).toBe('peer.example');
    });

    it('originInstance 無しは url の host にフォールバック', () => {
        const s: WorldSource = {
            kind: WorldSourceKind.RemoteInstance,
            url: 'https://peer.example:8080/api/v1/worlds/w1?x=1',
        };
        expect(worldOriginDomain(s)).toBe('peer.example:8080');
    });

    it('GitHub/URL も host を返す（今はドメイン表示）', () => {
        expect(
            worldOriginDomain({
                kind: WorldSourceKind.GitHub,
                url: 'https://raw.githubusercontent.com/o/r/main/w.yaml',
            }),
        ).toBe('raw.githubusercontent.com');
        expect(worldOriginDomain({ kind: WorldSourceKind.Url, url: 'http://example.com/w.yaml' })).toBe('example.com');
    });
});

describe('DependencySourceSchema', () => {
    it('url なし（ローカル）を受け付ける（version は省略時 "latest" が補われる）', () => {
        expect(DependencySourceSchema.parse({})).toEqual({ version: 'latest' });
    });

    it('url あり（外部 mod）を受け付ける', () => {
        expect(DependencySourceSchema.parse({ url: 'https://example.com/mods' })).toEqual({
            url: 'https://example.com/mods',
            version: 'latest',
        });
    });

    it('旧 type は余剰プロパティとして無視される（url の有無で同じ結果になる）', () => {
        expect(DependencySourceSchema.parse({ type: 'local' })).toEqual({ version: 'latest' });
        expect(DependencySourceSchema.parse({ type: 'url', url: 'https://example.com/mods' })).toEqual({
            url: 'https://example.com/mods',
            version: 'latest',
        });
        expect(DependencySourceSchema.parse({ type: 'repository', path: 'mods/pen' })).toEqual({
            version: 'latest',
        });
    });

    it('未知の余剰プロパティ（旧 path 等）は無視される', () => {
        const parsed = DependencySourceSchema.parse({ path: 'mods/pen', extra: 'x' });
        expect(parsed).not.toHaveProperty('path');
        expect(parsed).not.toHaveProperty('extra');
    });

    it('version は完全一致 (x.y.z) を受け付ける', () => {
        expect(DependencySourceSchema.parse({ version: '1.2.3' })).toEqual({ version: '1.2.3' });
    });

    it('version は省略可能だが、解決後は必ず "latest" が明示される（暗黙の最新追従を残さない）', () => {
        expect(DependencySourceSchema.parse({})).toEqual({ version: 'latest' });
    });

    it('version: "latest" を明示的に指定できる（常に最新を追う、を意図が読める形で書ける）', () => {
        expect(DependencySourceSchema.parse({ version: 'latest' })).toEqual({ version: 'latest' });
    });

    it('semver レンジ指定 (^, ~) は拒否される（"latest" 以外の非semver文字列は不可）', () => {
        expect(() => DependencySourceSchema.parse({ version: '^1.2.3' })).toThrow();
        expect(() => DependencySourceSchema.parse({ version: '~1.2.3' })).toThrow();
        expect(() => DependencySourceSchema.parse({ version: 'stable' })).toThrow();
    });
});

describe('core:collider world validation', () => {
    const entity = (component: InitialEntity['components'][number]): InitialEntity => ({
        id: 'player',
        transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
        components: [component],
        tags: [],
        children: [],
    });

    it('有効なbuilt-in colliderを受け付け、mod依存として収集しない', async () => {
        const input = [entity({ type: 'core:collider', data: { shape: 'rect', size: { w: 20, h: 10 } } })];
        expect(InitialEntitiesSchema.parse(input)).toEqual(input);
        expect(collectModIds(input)).toEqual([]);
    });

    it('未知のcore namespaceと不正なCollider dataを拒否する', () => {
        expect(() => InitialEntitiesSchema.parse([entity({ type: 'core:unknown', data: {} })])).toThrow();
        expect(() =>
            InitialEntitiesSchema.parse([
                entity({ type: 'core:collider', data: { shape: 'rect', size: { w: -1, h: 1 } } }),
            ]),
        ).toThrow();
    });
});
