import type { MediaTimelineIntent } from '@ubichill/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
    applyMediaTimelineIntent,
    clearMediaTimelines,
    getMediaTimeline,
    mediaTimelinePosition,
} from './mediaTimelineState';

const INSTANCE = 'media-test';

function intent(
    action: MediaTimelineIntent['action'],
    overrides: Partial<MediaTimelineIntent> = {},
): MediaTimelineIntent {
    return { sessionId: 'screen:main', mediaId: 'video-1', action, ...overrides };
}

afterEach(() => clearMediaTimelines(INSTANCE));

describe('mediaTimelineState', () => {
    it('server time と revision を付与し、再生中の位置を anchor から算出する', () => {
        const loaded = applyMediaTimelineIntent(INSTANCE, intent('load', { duration: 120 }), 'u1', 1_000);
        expect(loaded.success).toBe(true);
        expect(loaded.timeline?.revision).toBe(1);

        const playing = applyMediaTimelineIntent(INSTANCE, intent('play', { expectedRevision: 1 }), 'u1', 2_000);
        expect(playing.success).toBe(true);
        expect(playing.timeline?.phase).toBe('playing');
        if (!playing.timeline) throw new Error('timeline was not created');
        expect(mediaTimelinePosition(playing.timeline, 7_000)).toBe(5);
    });

    it('同じ mediaId の load は冪等で再生位置を戻さない', () => {
        applyMediaTimelineIntent(INSTANCE, intent('load'), 'u1', 1_000);
        applyMediaTimelineIntent(INSTANCE, intent('seek', { position: 42 }), 'u1', 2_000);
        const again = applyMediaTimelineIntent(INSTANCE, intent('load'), 'u2', 3_000);
        expect(again.timeline?.anchorTime).toBe(42);
        expect(again.timeline?.revision).toBe(2);
    });

    it('古い revision の更新を拒否し、現在の正本を返す', () => {
        applyMediaTimelineIntent(INSTANCE, intent('load'), 'u1', 1_000);
        const conflict = applyMediaTimelineIntent(INSTANCE, intent('play', { expectedRevision: 0 }), 'u2', 2_000);
        expect(conflict.success).toBe(false);
        expect(conflict.timeline?.revision).toBe(1);
        expect(getMediaTimeline(INSTANCE, 'screen:main')?.phase).toBe('paused');
    });

    it('不正な数値は保存しない', () => {
        const result = applyMediaTimelineIntent(INSTANCE, intent('load', { position: Number.NaN }), 'u1', 1_000);
        expect(result.success).toBe(false);
        expect(getMediaTimeline(INSTANCE, 'screen:main')).toBeNull();
    });

    it('null payload と不正 revision を拒否し、server state を変更しない', () => {
        const missing = applyMediaTimelineIntent(INSTANCE, null as unknown as MediaTimelineIntent, 'u1', 1_000);
        expect(missing.success).toBe(false);

        const invalidRevision = applyMediaTimelineIntent(
            INSTANCE,
            intent('load', { expectedRevision: 1.5 }),
            'u1',
            2_000,
        );
        expect(invalidRevision.success).toBe(false);
        expect(getMediaTimeline(INSTANCE, 'screen:main')).toBeNull();
    });
});
