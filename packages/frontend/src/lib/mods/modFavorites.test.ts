// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PackageDescriptor } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => [] as Array<{ message: string; level: string }>);
vi.mock('../api', () => ({ API_BASE: '' }));
vi.mock('../toast', () => ({
    pushToast: (message: string, level: string) => {
        toasts.push({ message, level });
        return 1;
    },
}));

const { modFavoriteKey, resetModFavorites, useModFavorites, visibleFavoriteMods } = await import('./modFavorites');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const pen = { author: 'alice@ubichill.test', id: 'pen' };
const far = { author: 'bob@far.test', id: 'pen' };

beforeEach(() => {
    resetModFavorites();
    toasts.length = 0;
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('modFavoriteKey', () => {
    it('作者参照の形で、作者が違えば同じ ID でも別の鍵', () => {
        expect(modFavoriteKey(pen)).toBe('@alice@ubichill.test/pen');
        expect(modFavoriteKey(far)).not.toBe(modFavoriteKey(pen));
    });
});

describe('useModFavorites', () => {
    it('お気に入りの mod の作者・ID を鍵にして読み、ワールドの worldRefs は混ぜない', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ worldRefs: ['https://a/w'], modRefs: [pen] })));
        const { result } = renderHook(() => useModFavorites());
        await waitFor(() => expect(result.current.isFavorite('@alice@ubichill.test/pen')).toBe(true));
        expect(result.current.favorites.size).toBe(1);
    });

    it('足すと作者と ID だけを送り、すぐに印が付く', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ worldRefs: [], modRefs: [] }))
            .mockResolvedValueOnce(json(far, 201));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useModFavorites());
        await act(async () => result.current.refresh());
        await act(async () => result.current.toggle(modFavoriteKey(far)));
        expect(result.current.isFavorite('@bob@far.test/pen')).toBe(true);
        const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(url).toBe('/api/v1/users/me/favorites/mods');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual(far);
    });

    it('断られたら印を戻し、サーバーの理由を出す（上限・見つからない・届かない）', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(json({ worldRefs: [], modRefs: [] }))
                .mockResolvedValueOnce(json({ error: 'お気に入りの mod は 100 件までです' }, 409)),
        );
        const { result } = renderHook(() => useModFavorites());
        await act(async () => result.current.refresh());
        await act(async () => result.current.toggle(modFavoriteKey(pen)));
        expect(result.current.isFavorite(modFavoriteKey(pen))).toBe(false);
        expect(toasts).toEqual([{ message: 'お気に入りの mod は 100 件までです', level: 'error' }]);
    });

    it('外すのに失敗したら印を戻す', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(json({ worldRefs: [], modRefs: [pen] }))
                .mockResolvedValueOnce(new Response(null, { status: 500 })),
        );
        const { result } = renderHook(() => useModFavorites());
        await act(async () => result.current.refresh());
        await act(async () => result.current.toggle(modFavoriteKey(pen)));
        expect(result.current.isFavorite(modFavoriteKey(pen))).toBe(true);
        expect(toasts[0]?.level).toBe('error');
    });

    it('ログアウトした後に届いた前の人の追加は反映しない', async () => {
        const slow = Promise.withResolvers<Response>();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(json({ worldRefs: [], modRefs: [] }))
                .mockReturnValueOnce(slow.promise)
                .mockResolvedValueOnce(json({ worldRefs: [], modRefs: [far] })),
        );
        const alice = renderHook(() => useModFavorites());
        await act(async () => alice.result.current.refresh());
        const request = Promise.withResolvers<void>();
        act(() => {
            void alice.result.current.toggle(modFavoriteKey(pen)).then(request.resolve, request.reject);
        });
        alice.unmount();
        act(() => resetModFavorites());

        const bob = renderHook(() => useModFavorites());
        await waitFor(() => expect(bob.result.current.favorites.size).toBe(1));
        await act(async () => {
            slow.resolve(json({ error: 'down' }, 503));
            await request.promise;
        });
        expect([...bob.result.current.favorites]).toEqual([modFavoriteKey(far)]);
        expect(toasts).toEqual([]);
    });
});

describe('visibleFavoriteMods', () => {
    const descriptor = (ref: typeof pen): PackageDescriptor => ({
        ...ref,
        version: '1.0.0',
        baseUrl: 'https://alice.github.io/mods',
    });
    const loaded = { mods: [descriptor(pen), descriptor(far)], unavailable: [{ author: 'carol@gone.test', id: 'x' }] };

    it('外したものは取り直さずに消し、戻したものは読み込み済みからまた出す', () => {
        expect(visibleFavoriteMods(loaded, new Set([modFavoriteKey(far)]))).toEqual({
            mods: [descriptor(far)],
            unavailable: [],
        });
        expect(
            visibleFavoriteMods(loaded, new Set([modFavoriteKey(pen), '@carol@gone.test/x'])).unavailable,
        ).toHaveLength(1);
    });
});
