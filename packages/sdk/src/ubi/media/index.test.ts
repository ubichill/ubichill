import type { MediaState, ModGuestCommand } from '@ubichill/shared/mod/types';
import { describe, expect, it } from 'vitest';
import { createMediaModule } from './index';

describe('Ubi.media', () => {
    it('オブジェクト形式 load は loadId と旧Host互換fieldを送る', () => {
        const sent: ModGuestCommand[] = [];
        const media = createMediaModule((command) => sent.push(command as ModGuestCommand));
        const loadId = media.load({
            targetId: 'main',
            source: { id: 'track-1', url: 'https://media.example/master.m3u8', type: 'hls' },
            presentation: 'video',
            sync: 'shared',
        });

        expect(loadId).toMatch(/^media_/);
        expect(sent).toEqual([
            {
                type: 'MEDIA_LOAD',
                payload: expect.objectContaining({
                    targetId: 'main',
                    url: 'https://media.example/master.m3u8',
                    mediaType: 'hls',
                    kind: 'video',
                    loadId,
                    sync: 'shared',
                }),
            },
        ]);
    });

    it('旧 load 形式も維持する', () => {
        const sent: ModGuestCommand[] = [];
        const media = createMediaModule((command) => sent.push(command as ModGuestCommand));
        media.load('https://media.example/movie.mp4', 'main', 'video', 'audio');
        expect(sent[0]).toEqual({
            type: 'MEDIA_LOAD',
            payload: expect.objectContaining({
                url: 'https://media.example/movie.mp4',
                targetId: 'main',
                mediaType: 'video',
                kind: 'audio',
            }),
        });
    });

    it('Host state snapshot を getState から参照できる', () => {
        const media = createMediaModule(() => {});
        const state = {
            targetId: 'main',
            loadId: 'load-1',
            status: 'ready',
        } as MediaState;
        expect(media.getState('main')).toBeNull();
        media._handleState(state);
        expect(media.getState('main')).toBe(state);
    });
});
