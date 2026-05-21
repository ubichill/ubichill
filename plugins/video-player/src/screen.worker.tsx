/**
 * video-player:screen Worker — メディア実行者。
 *
 * 状態を持たない。Ubi.event.emit で受信したコマンドを Ubi.media.* に流すだけ。
 * 黒 16:9 の背景は host 側の <video> 要素が標準で持つ。
 *
 * 受信 (Ubi.event):
 *  - 'vp:media:load'   { url, mode }    - HLS / VOD ロード
 *  - 'vp:media:play'                    - 再生開始
 *  - 'vp:media:pause'                   - 一時停止
 *  - 'vp:media:seek'   { time }         - シーク
 *  - 'vp:media:volume' { volume }       - 音量
 *
 * 送信 (Ubi.event, controls 宛):
 *  - 'vp:media:time'   { currentTime, duration }  - timeupdate
 *  - 'vp:media:loaded' { duration }               - loadedmetadata
 *  - 'vp:media:ended'                             - ended
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';

const TARGET = 'main';
const controlsTarget = { scope: 'siblings' as const, targetType: 'video-player:controls' };

// 動画要素は常時表示
Ubi.media.setVisible(true, TARGET);

const ScreenSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const ev of events) {
        // controls からのコマンド
        if (ev.type === 'vp:media:load') {
            const { url, mode } = ev.payload as { url: string; mode: 'live' | 'video' };
            Ubi.media.load(url, TARGET, mode === 'live' ? 'hls' : 'auto');
        } else if (ev.type === 'vp:media:play') {
            Ubi.media.play(TARGET);
        } else if (ev.type === 'vp:media:pause') {
            Ubi.media.pause(TARGET);
        } else if (ev.type === 'vp:media:seek') {
            const { time } = ev.payload as { time: number };
            Ubi.media.seek(time, TARGET);
        } else if (ev.type === 'vp:media:volume') {
            const { volume } = ev.payload as { volume: number };
            Ubi.media.setVolume(volume, TARGET);
        }
        // <video> 要素から (usePluginMedia ハンドラ経由)
        else if (ev.type === 'media:timeUpdate') {
            const p = ev.payload as { targetId: string; currentTime: number; duration: number };
            if (p.targetId !== TARGET) continue;
            Ubi.event.emit('vp:media:time', { currentTime: p.currentTime, duration: p.duration }, controlsTarget);
        } else if (ev.type === 'media:loaded') {
            const p = ev.payload as { targetId: string; duration: number };
            if (p.targetId !== TARGET) continue;
            Ubi.event.emit('vp:media:loaded', { duration: p.duration }, controlsTarget);
        } else if (ev.type === 'media:ended') {
            const p = ev.payload as { targetId: string };
            if (p.targetId !== TARGET) continue;
            Ubi.event.emit('vp:media:ended', {}, controlsTarget);
        } else if (ev.type === 'media:error') {
            const p = ev.payload as { targetId: string; message: string };
            if (p.targetId === TARGET) Ubi.log(`[screen] media error: ${p.message}`, 'warn');
        }
    }
};

Ubi.registerSystem(ScreenSystem);
