import { FAVORITES_VISIBILITIES } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { FAVORITES_VISIBILITY_OPTIONS, favoritesVisibilityNote } from './favoritesVisibility';

describe('FAVORITES_VISIBILITY_OPTIONS', () => {
    it('shared の公開範囲をすべて、重複なく選べる（値が増えても選択肢の追加漏れに気づける）', () => {
        expect(FAVORITES_VISIBILITY_OPTIONS.map((o) => o.value).sort()).toEqual([...FAVORITES_VISIBILITIES].sort());
    });

    it('狭い順（Private → Friends → Public）に並ぶ', () => {
        expect(FAVORITES_VISIBILITY_OPTIONS.map((o) => o.value)).toEqual(['private', 'friends', 'public']);
    });
});

describe('favoritesVisibilityNote', () => {
    it('Public では外部ワールドの URL とフェディバースの固定ノートに出ることを伝え、ほかは補足なし', () => {
        expect(favoritesVisibilityNote('public')).toContain('外部');
        expect(favoritesVisibilityNote('public')).toContain('固定ノート');
        expect(favoritesVisibilityNote('friends')).toBeNull();
        expect(favoritesVisibilityNote('private')).toBeNull();
    });
});
