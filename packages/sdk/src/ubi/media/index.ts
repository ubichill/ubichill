import { CommandType } from '@ubichill/shared/mod/protocol';
import type { SendFn } from '../types';

export type MediaModule = {
    /**
     * メディアを読み込む。
     * @param targetId  複数プレイヤーを描き分けるときの識別子（省略時は `'default'`）。
     * @param mediaType 読み込み方式（輸送層）。`'hls'`（ライブ配信）/`'video'`（ネイティブ）/`'auto'`（拡張子から推定）。
     * @param kind      メディア種別。`'audio'` はデバイス操作を既定で許可しバックグラウンド再生を継続、
     *                  `'video'`（既定）はデバイス操作を明示許可までロックする。
     */
    load(url: string, targetId?: string, mediaType?: 'hls' | 'video' | 'auto', kind?: 'audio' | 'video'): void;
    /** 再生を開始する（省略時は `'default'`）。 */
    play(targetId?: string): void;
    /** 再生を一時停止する。 */
    pause(targetId?: string): void;
    /** 再生位置を秒単位でシークする。 */
    seek(time: number, targetId?: string): void;
    /** 音量を 0〜1 で設定する。 */
    setVolume(volume: number, targetId?: string): void;
    /** プレイヤーを破棄してリソースを解放する。 */
    destroy(targetId?: string): void;
    /** プレイヤーの表示/非表示を切り替える（読み込み状態は保持）。 */
    setVisible(visible: boolean, targetId?: string): void;
    /**
     * デバイス由来（OS メディアキー / ロック画面 / PiP / リモート再生）の再生操作を許可するか。
     * 既定は false（=mod命令 play/pause のみ受け付け、デバイス操作は無効化）。
     */
    setDeviceControl(enabled: boolean, targetId?: string): void;
};

export function createMediaModule(send: SendFn): MediaModule {
    return {
        load: (url, targetId = 'default', mediaType, kind) =>
            send({ type: CommandType.MEDIA_LOAD, payload: { targetId, url, mediaType, kind } }),
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
