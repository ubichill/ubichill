import { describe, expect, it } from 'vitest';
import { DependencySourceSchema, type WorldSource, WorldSourceKind, worldOriginDomain } from './world.schema';

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
    it('type: local をそのまま受け付ける', () => {
        expect(DependencySourceSchema.parse({ type: 'local' })).toEqual({ type: 'local' });
    });

    it('type: url + url を受け付ける', () => {
        expect(DependencySourceSchema.parse({ type: 'url', url: 'https://example.com/mods' })).toEqual({
            type: 'url',
            url: 'https://example.com/mods',
        });
    });

    it('後方互換: 旧 type: repository は local に変換される（既存ワールドの読み込みを壊さない）', () => {
        expect(DependencySourceSchema.parse({ type: 'repository', path: 'mods/pen' })).toEqual({ type: 'local' });
    });

    it('未知の余剰プロパティ（旧 path 等）は無視される', () => {
        const parsed = DependencySourceSchema.parse({ type: 'local', path: 'mods/pen', extra: 'x' });
        expect(parsed).not.toHaveProperty('path');
        expect(parsed).not.toHaveProperty('extra');
    });

    it('type: npm は廃止済みで拒否される', () => {
        expect(() => DependencySourceSchema.parse({ type: 'npm' })).toThrow();
    });
});
