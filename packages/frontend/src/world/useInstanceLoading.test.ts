// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMEOUT_MESSAGE } from './loadingFailure';
import { useInstanceLoading } from './useInstanceLoading';

const idle = {
    isAuthPending: false,
    isConnected: false,
    isConnecting: false,
    isJoined: false,
    error: null,
    mods: { completed: 0, total: 0 },
    workers: { ready: 0, total: 0 },
};

/** 部屋に入って読み込み終える（join 済みで mod も Worker も無い）。 */
const entered = { ...idle, isConnected: true, isJoined: true };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useInstanceLoading', () => {
    it('A に 30 秒いて B へ移り、25 秒の内に A へ戻っても、前の A のタイムアウトを読まない', () => {
        const { result, rerender } = renderHook(
            (props: { instanceId: string; joined: boolean }) =>
                useInstanceLoading({ ...(props.joined ? entered : idle), instanceId: props.instanceId }),
            { initialProps: { instanceId: 'a', joined: true } },
        );
        act(() => vi.advanceTimersByTime(30_000));
        expect(result.current.failed).toBe(false);

        // B へ移る（前の部屋を抜けて、まだつないでいない）
        rerender({ instanceId: 'b', joined: false });
        expect(result.current.failed).toBe(false);
        act(() => vi.advanceTimersByTime(5_000));
        rerender({ instanceId: 'b', joined: true });

        // 5 秒後に A へ戻る。最初の描画でも、その後も、入る前にタイムアウトにしない
        act(() => vi.advanceTimersByTime(5_000));
        rerender({ instanceId: 'a', joined: false });
        expect(result.current.failed).toBe(false);
        act(() => vi.advanceTimersByTime(24_000));
        expect(result.current.failed).toBe(false);
    });

    it('入れないまま 25 秒たてば、その入室はタイムアウトにする', () => {
        const { result } = renderHook(() => useInstanceLoading({ ...idle, instanceId: 'a' }));
        act(() => vi.advanceTimersByTime(24_999));
        expect(result.current.failed).toBe(false);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.failureMessage).toBe(TIMEOUT_MESSAGE);
    });

    it('A で失敗したあと B へ移れば、B の読み込みは失敗にしない', () => {
        const { result, rerender } = renderHook(
            (props: { instanceId: string; error: string | null }) =>
                useInstanceLoading({ ...idle, instanceId: props.instanceId, error: props.error }),
            { initialProps: { instanceId: 'a', error: '満員です' as string | null } },
        );
        expect(result.current.failureMessage).toBe('満員です');
        rerender({ instanceId: 'b', error: null });
        expect(result.current.failed).toBe(false);
    });
});
