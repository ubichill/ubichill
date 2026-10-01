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
    it('Friends では、フレンド機能が準備中で自分だけが見られる状態と同じことを伝える', () => {
        expect(favoritesVisibilityNote('friends')).toContain('準備中');
    });

    it('Public では外部ワールドの URL も見えることを伝え、Private では補足なし', () => {
        expect(favoritesVisibilityNote('public')).toContain('外部');
        expect(favoritesVisibilityNote('private')).toBeNull();
    });
});
