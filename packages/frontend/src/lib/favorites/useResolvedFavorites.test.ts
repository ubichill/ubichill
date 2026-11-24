import { describe, expect, it } from 'vitest';
import { needsReload } from './useResolvedFavorites';

describe('needsReload', () => {
    const requested = new Set(['https://a/1', 'https://a/2', 'https://a/dead']);

    it('外しただけなら取り直さない', () => {
        expect(needsReload(requested, new Set(['https://a/1']))).toBe(false);
        expect(needsReload(requested, new Set())).toBe(false);
    });

    it('取得を依頼した後に増えたお気に入りがあるときだけ取り直す', () => {
        expect(needsReload(requested, new Set(['https://a/1', 'https://a/new']))).toBe(true);
    });

    it('サーバーが URL を正規化して返しても（返ってきた URL と一致しなくても）取り直し続けない', () => {
        // お気に入りには .../foo/yaml の形で入っているが、ワールドの正規 URL は .../foo
        const sent = new Set(['https://a/api/v1/worlds/foo/yaml']);
        expect(needsReload(sent, new Set(['https://a/api/v1/worlds/foo/yaml']))).toBe(false);
    });
});
