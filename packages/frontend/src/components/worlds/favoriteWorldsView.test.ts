import type { WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { visibleFavorites } from './favoriteWorldsView';

const world = (url: string) => ({ url, id: url, displayName: url }) as WorldListItem;
const loaded = { worlds: [world('https://a/1'), world('https://a/2')], unavailable: ['https://a/dead'] };

describe('visibleFavorites', () => {
    it('お気に入りから外したものを、取り直さずに消す', () => {
        const view = visibleFavorites(loaded, new Set(['https://a/2']));
        expect(view.worlds.map((w) => w.url)).toEqual(['https://a/2']);
        expect(view.unavailable).toEqual([]);
    });

    it('外してから戻したものは、読み込み済みの結果からまた表示される', () => {
        expect(visibleFavorites(loaded, new Set(['https://a/1', 'https://a/dead'])).worlds).toHaveLength(1);
        expect(visibleFavorites(loaded, new Set(['https://a/1', 'https://a/2', 'https://a/dead'])).worlds).toHaveLength(
            2,
        );
    });
});
