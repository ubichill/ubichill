import { CommandType } from '@ubichill/shared';
import type { SendFn } from '../types';

export type MediaModule = {
    load(url: string, targetId?: string, mediaType?: 'hls' | 'video' | 'auto'): void;
    play(targetId?: string): void;
    pause(targetId?: string): void;
    seek(time: number, targetId?: string): void;
    setVolume(volume: number, targetId?: string): void;
    destroy(targetId?: string): void;
    setVisible(visible: boolean, targetId?: string): void;
    /**
     * デバイス由来（OS メディアキー / ロック画面 / PiP / リモート再生）の再生操作を許可するか。
     * 既定は false（=プラグイン命令 play/pause のみ受け付け、デバイス操作は無効化）。
     */
    setDeviceControl(enabled: boolean, targetId?: string): void;
};

export function createMediaModule(send: SendFn): MediaModule {
    return {
        load: (url, targetId = 'default', mediaType) =>
            send({ type: CommandType.MEDIA_LOAD, payload: { targetId, url, mediaType } }),
        play: (targetId = 'default') => send({ type: CommandType.MEDIA_PLAY, payload: { targetId } }),
        pause: (targetId = 'default') => send({ type: CommandType.MEDIA_PAUSE, payload: { targetId } }),
        seek: (time, targetId = 'default') => send({ type: CommandType.MEDIA_SEEK, payload: { targetId, time } }),
        setVolume: (volume, targetId = 'default') =>
            send({ type: CommandType.MEDIA_SET_VOLUME, payload: { targetId, volume } }),
        destroy: (targetId = 'default') => send({ type: CommandType.MEDIA_DESTROY, payload: { targetId } }),
        setVisible: (visible, targetId = 'default') =>
            send({ type: CommandType.MEDIA_SET_VISIBLE, payload: { targetId, visible } }),
        setDeviceControl: (enabled, targetId = 'default') =>
            send({ type: CommandType.MEDIA_SET_DEVICE_CONTROL, payload: { targetId, enabled } }),
    };
}
