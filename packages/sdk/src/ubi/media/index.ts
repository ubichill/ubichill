import { CommandType } from '@ubichill/shared/mod/protocol';
import type { MediaLoadOptions, MediaPresentation, MediaSourceType, MediaState } from '@ubichill/shared/mod/types';
import type { SendFn } from '../types';

export type MediaModule = {
    /** メディアを読み込み、イベント照合用の loadId を返す。 */
    load(options: MediaLoadOptions): string;
    /** @deprecated オブジェクト形式 `load({ source, ... })` を使用する。 */
    load(url: string, targetId?: string, mediaType?: 'hls' | 'video' | 'auto', kind?: MediaPresentation): string;
    /** Host から最後に通知された状態。未通知なら null。 */
    getState(targetId?: string): MediaState | null;
    play(targetId?: string): void;
    pause(targetId?: string): void;
    seek(time: number, targetId?: string): void;
    setVolume(volume: number, targetId?: string): void;
    destroy(targetId?: string): void;
    setVisible(visible: boolean, targetId?: string): void;
    setDeviceControl(enabled: boolean, targetId?: string): void;
    /** @internal Host event から SDK cache を更新。 */
    _handleState(state: MediaState): void;
};

let loadCounter = 0;

function nextLoadId(): string {
    loadCounter = (loadCounter + 1) % Number.MAX_SAFE_INTEGER;
    return `media_${Date.now().toString(36)}_${loadCounter.toString(36)}`;
}

function legacyType(type: MediaSourceType | undefined): 'hls' | 'video' | 'auto' | undefined {
    return type === 'file' ? 'video' : type;
}

export function createMediaModule(send: SendFn): MediaModule {
    const states = new Map<string, MediaState>();

    function load(options: MediaLoadOptions): string;
    function load(
        url: string,
        targetId?: string,
        mediaType?: 'hls' | 'video' | 'auto',
        kind?: MediaPresentation,
    ): string;
    function load(
        input: MediaLoadOptions | string,
        legacyTargetId = 'default',
        mediaType?: 'hls' | 'video' | 'auto',
        kind?: MediaPresentation,
    ): string {
        const options: MediaLoadOptions =
            typeof input === 'string'
                ? {
                      source: { url: input, type: mediaType === 'video' ? 'file' : mediaType },
                      targetId: legacyTargetId,
                      presentation: kind,
                  }
                : input;
        const targetId = options.targetId ?? 'default';
        const presentation = options.presentation ?? 'video';
        const loadId = nextLoadId();
        send({
            type: CommandType.MEDIA_LOAD,
            payload: {
                // 旧 Host 互換 field も送る。
                targetId,
                url: options.source.url,
                mediaType: legacyType(options.source.type),
                kind: presentation,
                source: options.source,
                presentation,
                loadId,
                sync: options.sync ?? 'local',
                deviceControl: options.deviceControl,
            },
        });
        return loadId;
    }

    return {
        load,
        getState: (targetId = 'default') => states.get(targetId) ?? null,
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
        _handleState: (state) => states.set(state.targetId, state),
    };
}
