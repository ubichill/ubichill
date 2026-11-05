import { describe, expect, it } from 'vitest';
import { resolveWorldDist, WORLD_DIST_ENV } from './worldAssets.ts';

describe('resolveWorldDist', () => {
    it('環境変数 → 候補の順に world.html のある場所を選ぶ', () => {
        const exists = (path: string) => path === '/repo/packages/frontend/dist/world.html';
        expect(
            resolveWorldDist({ env: {}, candidates: ['/pkg/world', '/repo/packages/frontend/dist'], exists }),
        ).toEqual({
            path: '/repo/packages/frontend/dist',
        });
        expect(
            resolveWorldDist({
                env: { [WORLD_DIST_ENV]: '/custom' },
                candidates: ['/repo/packages/frontend/dist'],
                exists: (path) => path === '/custom/world.html',
            }),
        ).toEqual({ path: '/custom' });
    });
    it('無ければ frontend のビルドを案内し、環境変数が間違っていれば候補を見ない', () => {
        expect(resolveWorldDist({ env: {}, candidates: ['/a'], exists: () => false })).toMatchObject({
            error: expect.stringContaining('pnpm --filter @ubichill/frontend build:world'),
        });
        expect(
            resolveWorldDist({
                env: { [WORLD_DIST_ENV]: '/nope' },
                candidates: ['/a'],
                exists: (p) => p === '/a/world.html',
            }),
        ).toMatchObject({ error: expect.stringContaining('/nope') });
    });
});
