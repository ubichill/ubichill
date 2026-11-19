// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ API_BASE: '' }));
vi.mock('../../lib/worlds/instancesApi', () => ({ createInstance: vi.fn(), fetchInstances: vi.fn() }));

const { resetFavorites, useFavorites } = await import('./useFavorites');
const { resetWorldsCache, useInstances } = await import('./useInstances');

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const world = (id: string) => ({ id, displayName: id });

/** 手で返すまで待たせる応答。 */
function deferred() {
    const box: { resolve: (r: Response) => void } = { resolve: () => undefined };
    const promise = new Promise<Response>((resolve) => {
        box.resolve = resolve;
    });
    return { promise, resolve: (r: Response) => box.resolve(r) };
}

beforeEach(() => {
    resetFavorites();
    resetWorldsCache();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('お気に入り: ログアウトで前の人の一覧を捨てる', () => {
    it('捨てた後に開いた画面は、次の人の一覧を読み直す', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ worldRefs: ['https://a.example/alice-room'] }))
            .mockResolvedValueOnce(json({ worldRefs: ['https://b.example/bob-room'] }));
        vi.stubGlobal('fetch', fetchMock);

        const alice = renderHook(() => useFavorites());
        await waitFor(() => expect(alice.result.current.isFavorite('https://a.example/alice-room')).toBe(true));
        alice.unmount();

        act(() => resetFavorites());
        const bob = renderHook(() => useFavorites());
        expect(bob.result.current.favorites.size).toBe(0);
        await waitFor(() => expect(bob.result.current.isFavorite('https://b.example/bob-room')).toBe(true));
        expect(bob.result.current.isFavorite('https://a.example/alice-room')).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['削除の失敗', '追加の成功'])('ログアウト後は前の人のお気に入り変更を反映しない（%s）', async (kind) => {
        const priorRef = 'https://a.example/alice-room';
        const removing = kind === '削除の失敗';
        const slow = deferred();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(json({ worldRefs: removing ? [priorRef] : [] }))
                .mockReturnValueOnce(slow.promise)
                .mockResolvedValueOnce(json({ worldRefs: ['https://b.example/bob-room'] })),
        );
        const alice = renderHook(() => useFavorites());
        await act(async () => alice.result.current.refresh());
        const request = Promise.withResolvers<void>();
        act(() => {
            void alice.result.current.toggle(priorRef).then(request.resolve, request.reject);
        });
        alice.unmount();
        act(() => resetFavorites());

        const bob = renderHook(() => useFavorites());
        await waitFor(() => expect(bob.result.current.favorites.size).toBe(1));
        await act(async () => {
            slow.resolve(removing ? new Response(null, { status: 500 }) : json({ worldRef: `${priorRef}.json` }));
            await request.promise;
        });
        expect([...bob.result.current.favorites]).toEqual(['https://b.example/bob-room']);
    });

    it('読んでいる途中で捨てたら、届いた前の人の一覧は入れない', async () => {
        const slow = deferred();
        const fetchMock = vi
            .fn()
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce(json({ worldRefs: ['https://b.example/bob-room'] }));
        vi.stubGlobal('fetch', fetchMock);

        const alice = renderHook(() => useFavorites());
        act(() => resetFavorites());
        await act(async () => slow.resolve(json({ worldRefs: ['https://a.example/alice-room'] })));
        expect(alice.result.current.favorites.size).toBe(0);
        alice.unmount();

        const bob = renderHook(() => useFavorites());
        await waitFor(() => expect(bob.result.current.isFavorite('https://b.example/bob-room')).toBe(true));
        expect(bob.result.current.favorites.size).toBe(1);
    });
});

describe('ワールド一覧: ログアウトで 30 秒のキャッシュを捨てる', () => {
    it('捨てた後に開いた画面は、キャッシュの期間内でも次の人の一覧を読み直す', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ worlds: [world('alice-private')] }))
            .mockResolvedValueOnce(json({ worlds: [world('bob-private')] }));
        vi.stubGlobal('fetch', fetchMock);

        const alice = renderHook(() => useInstances());
        await waitFor(() => expect(alice.result.current.worlds.map((w) => w.id)).toEqual(['alice-private']));
        alice.unmount();

        resetWorldsCache();
        const bob = renderHook(() => useInstances());
        await waitFor(() => expect(bob.result.current.worlds.map((w) => w.id)).toEqual(['bob-private']));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('捨てなければ、キャッシュの期間内は読み直さない', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => json({ worlds: [world('shared')] }));
        vi.stubGlobal('fetch', fetchMock);
        const first = renderHook(() => useInstances());
        await waitFor(() => expect(first.result.current.worlds).toHaveLength(1));
        first.unmount();
        const second = renderHook(() => useInstances());
        await waitFor(() => expect(second.result.current.worlds).toHaveLength(1));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('読んでいる途中で捨てたら、届いた前の人の一覧をキャッシュに入れない', async () => {
        const slow = deferred();
        const fetchMock = vi
            .fn()
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce(json({ worlds: [world('bob-private')] }));
        vi.stubGlobal('fetch', fetchMock);

        const alice = renderHook(() => useInstances());
        resetWorldsCache();
        await act(async () => slow.resolve(json({ worlds: [world('alice-private')] })));
        alice.unmount();

        const bob = renderHook(() => useInstances());
        await waitFor(() => expect(bob.result.current.worlds.map((w) => w.id)).toEqual(['bob-private']));
    });
});
