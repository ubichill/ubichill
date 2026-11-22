import { describe, expect, it } from 'vitest';
import { WORLD_THUMBNAIL_REQUIRED, worldPublishProblem } from './publishRequirements';

describe('worldPublishProblem', () => {
    it('サムネイルがあれば公開できる', () => {
        expect(worldPublishProblem({ thumbnail: 'https://example.com/a.png' })).toBeNull();
    });

    it('無い・空・空白だけ・null なら公開できない', () => {
        for (const thumbnail of [undefined, '', '   ', null])
            expect(worldPublishProblem({ thumbnail })).toBe(WORLD_THUMBNAIL_REQUIRED);
    });
});
