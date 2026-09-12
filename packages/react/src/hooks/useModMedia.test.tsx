// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ModHostEvent } from '@ubichill/shared';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerModDefinition } from '../types';
import { useModMedia } from './useModMedia';

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
