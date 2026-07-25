import { describe, expect, it } from 'vitest';
import { type WorldSource, WorldSourceKind, worldOriginDomain } from './world.schema';

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
