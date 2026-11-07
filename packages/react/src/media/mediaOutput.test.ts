// @vitest-environment jsdom
import type { MediaState, ModHostEvent } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaRuntime } from './createMediaRuntime';
import { createMediaOutputStore, effectiveVolume, normalizeMediaOutput } from './mediaOutput';

describe('normalizeMediaOutput', () => {
    it.each([
        [null, { volume: 1, muted: false }],
        ['loud', { volume: 1, muted: false }],
        [
            { volume: 2, muted: 'yes' },
            { volume: 1, muted: false },
        ],
        [
            { volume: -0.5, muted: true },
            { volume: 0, muted: true },
        ],
        [{ volume: Number.NaN }, { volume: 1, muted: false }],
        [{ volume: 0.25 }, { volume: 0.25, muted: false }],
    ])('壊れた保存値 %j でも使える値にする', (input, expected) => {
        expect(normalizeMediaOutput(input)).toEqual(expected);
    });
});

describe('effectiveVolume', () => {
    it('mod の音量に全体の音量を掛ける（範囲外は丸める）', () => {
        expect(effectiveVolume(0.5, { volume: 0.5, muted: false })).toBe(0.25);
        expect(effectiveVolume(3, { volume: 0.4, muted: false })).toBe(0.4);
        expect(effectiveVolume(-1, { volume: 1, muted: false })).toBe(0);
    });
});

describe('createMediaOutputStore', () => {
    it('値が変わらない set では知らせない（スライダーの連打で全 video を触らない）', () => {
        const store = createMediaOutputStore();
        const listener = vi.fn();
        store.subscribe(listener);
        store.set({ volume: 1 });
        store.set({ volume: 5 });
        expect(listener).not.toHaveBeenCalled();
        store.set({ muted: true });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('購読をやめたら知らせない', () => {
        const store = createMediaOutputStore();
        const listener = vi.fn();
        const stop = store.subscribe(listener);
        stop();
        store.set({ volume: 0.3 });
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('createMediaRuntime と全体の出力', () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    const setup = (initial = { volume: 0.5, muted: false }) => {
        const output = createMediaOutputStore(initial);
        const events: ModHostEvent[] = [];
        const runtime = createMediaRuntime({
            definitionId: 'm:screen',
            syncScopeId: 'w',
            modId: 'm',
            permissionSubject: 'm',
            mediaVisibility: new Map(),
            getSocket: () => null,
            authorizeUrl: async (url) => ({ allowed: true, url }),
            sendEvent: (event) => events.push(event),
            output,
        });
        const video = document.createElement('video');
        runtime.getVideoRef('main')(video);
        const lastState = (): MediaState =>
            events.filter((e) => e.type === 'EVT_MEDIA_STATE').at(-1)?.payload as MediaState;
        return { output, runtime, video, lastState };
    };

    it('mount した時点で全体の音量が掛かる', () => {
        const { video } = setup({ volume: 0.5, muted: true });
        expect(video.volume).toBe(0.5);
        expect(video.muted).toBe(true);
    });

    it('mod の setVolume に掛け合わせ、mod には mod が決めた音量を見せる（mod の UI が全体の音量で動かない）', () => {
        const { runtime, video, lastState } = setup();
        runtime.mediaHandlers.onMediaSetVolume?.('main', 0.8);
        expect(video.volume).toBeCloseTo(0.4);
        video.dispatchEvent(new Event('volumechange'));
        expect(lastState().volume).toBe(0.8);
    });

    it('全体の音量・ミュートを変えると、再生中の video にすぐ反映する', () => {
        const { output, runtime, video } = setup();
        runtime.mediaHandlers.onMediaSetVolume?.('main', 0.6);
        output.set({ volume: 1 });
        expect(video.volume).toBeCloseTo(0.6);
        output.set({ muted: true });
        expect(video.muted).toBe(true);
    });

    it('破棄したランタイムは全体の変更を受けない（古い video を触らない）', () => {
        const { output, runtime, video } = setup();
        runtime.destroy();
        output.set({ volume: 0.1 });
        expect(video.volume).toBe(0.5);
    });
});
