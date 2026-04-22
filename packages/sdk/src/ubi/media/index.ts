import type { SendFn } from '../types';

export type MediaModule = {
    load(url: string, targetId?: string, mediaType?: 'hls' | 'video' | 'auto'): void;
    play(targetId?: string): void;
    pause(targetId?: string): void;
    seek(time: number, targetId?: string): void;
    setVolume(volume: number, targetId?: string): void;
    destroy(targetId?: string): void;
    setVisible(visible: boolean, targetId?: string): void;
};

export function createMediaModule(send: SendFn): MediaModule {
    return {
        load: (url, targetId = 'default', mediaType) =>
            send({ type: 'MEDIA_LOAD', payload: { targetId, url, mediaType } }),
        play: (targetId = 'default') => send({ type: 'MEDIA_PLAY', payload: { targetId } }),
        pause: (targetId = 'default') => send({ type: 'MEDIA_PAUSE', payload: { targetId } }),
        seek: (time, targetId = 'default') => send({ type: 'MEDIA_SEEK', payload: { targetId, time } }),
        setVolume: (volume, targetId = 'default') => send({ type: 'MEDIA_SET_VOLUME', payload: { targetId, volume } }),
        destroy: (targetId = 'default') => send({ type: 'MEDIA_DESTROY', payload: { targetId } }),
        setVisible: (visible, targetId = 'default') =>
            send({ type: 'MEDIA_SET_VISIBLE', payload: { targetId, visible } }),
    };
}
