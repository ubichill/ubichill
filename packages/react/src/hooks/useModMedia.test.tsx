// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ModHostEvent } from '@ubichill/shared';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerModDefinition } from '../types';
import { planTimelinePlaybackCorrection, useModMedia } from './useModMedia';

vi.mock('./useSocket', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('./useExternalUrlAuthorization', () => ({
    useExternalUrlAuthorization: () => async (url: string) => ({ allowed: true, url }),
}));

const definition: WorkerModDefinition = {
    id: 'test-media:screen',
    name: 'test media',
    workerCode: '',
    mediaTargets: ['main'],
};

let rejectPlay: ((reason: unknown) => void) | null = null;

beforeEach(() => {
    rejectPlay = null;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
        () =>
            new Promise<void>((_resolve, reject) => {
                rejectPlay = reject;
            }),
    );
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

function setup() {
    const events: ModHostEvent[] = [];
    const sendEventRef = { current: (event: ModHostEvent) => events.push(event) } as React.RefObject<
        ((event: ModHostEvent) => void) | null
    >;
    const hook = renderHook(() => useModMedia(definition, sendEventRef));
    const video = document.createElement('video');
    act(() => hook.result.current.getVideoRef('main')(video));
    return { ...hook, events };
}

describe('useModMedia: play intent の競合', () => {
    it('play() 完了前に pause された場合の reject を media:error にしない', async () => {
        const { result, events, unmount } = setup();

        act(() => {
            result.current.mediaHandlers.onMediaPlay?.('main');
            result.current.mediaHandlers.onMediaPause?.('main');
        });
        await act(async () => {
            rejectPlay?.(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
            await Promise.resolve();
        });

        expect(events.some((event) => event.type === 'EVT_MEDIA_ERROR')).toBe(false);
        unmount();
    });

    it('現在も再生意図がある play() の reject は非致命エラーとして通知する', async () => {
        const { result, events, unmount } = setup();

        act(() => result.current.mediaHandlers.onMediaPlay?.('main'));
        await act(async () => {
            rejectPlay?.(new DOMException('Autoplay is not allowed.', 'NotAllowedError'));
            await Promise.resolve();
        });

        expect(events.find((event) => event.type === 'EVT_MEDIA_ERROR')).toMatchObject({
            payload: { error: { code: 'play_rejected', fatal: false } },
        });
        unmount();
    });
});

describe('planTimelinePlaybackCorrection', () => {
    it('停止中は小さな通信遅延でも正規位置へ固定する', () => {
        expect(planTimelinePlaybackCorrection('paused', 20.2, 20, 1)).toEqual({
            seekTime: 20.2,
            playbackRate: 1,
        });
    });

    it('再生中の小さな遅れは再生速度で滑らかに追いつく', () => {
        const correction = planTimelinePlaybackCorrection('playing', 20.4, 20, 1);
        expect(correction.seekTime).toBeNull();
        expect(correction.playbackRate).toBeCloseTo(1.04);
    });

    it('再生中の大きな遅れは即座に seek する', () => {
        expect(planTimelinePlaybackCorrection('playing', 22, 20, 1)).toEqual({
            seekTime: 22,
            playbackRate: 1,
        });
    });

    it('十分同期したら正規再生速度へ戻す', () => {
        expect(planTimelinePlaybackCorrection('playing', 20.05, 20, 1)).toEqual({
            seekTime: null,
            playbackRate: 1,
        });
    });
});
