/**
 * video-player:screen Worker — メディア実行者。
 *
 * 状態を持たない。VPEvents 経由で受信したコマンドを Ubi.media.* に流し、
 * Ubi.media SDK からの DOM <video> イベント (media:*) を controls へ転送するだけ。
 * 黒 16:9 の背景は host 側の <video> 要素が標準で持つ。
 */

import { VPEvents } from './events';

const TARGET = 'main';
const controlsTarget = { scope: 'siblings' as const, targetType: 'video-player:controls' };

// 動画要素は常時表示
Ubi.media.setVisible(true, TARGET);

// ── controls からのコマンドを Ubi.media に流す ───────
VPEvents.on('vp:media:load', ({ url, mode }) => {
    Ubi.media.load(url, TARGET, mode === 'live' ? 'hls' : 'auto');
});
VPEvents.on('vp:media:play', () => Ubi.media.play(TARGET));
VPEvents.on('vp:media:pause', () => Ubi.media.pause(TARGET));
VPEvents.on('vp:media:seek', ({ time }) => Ubi.media.seek(time, TARGET));
VPEvents.on('vp:media:volume', ({ volume }) => Ubi.media.setVolume(volume, TARGET));

// ── <video> 要素のイベント (Ubi.media SDK) → controls へ転送 ──
VPEvents.on('media:timeUpdate', ({ targetId, currentTime, duration }) => {
    if (targetId !== TARGET) return;
    VPEvents.emit('vp:media:time', { currentTime, duration }, controlsTarget);
});
VPEvents.on('media:loaded', ({ targetId, duration }) => {
    if (targetId !== TARGET) return;
    VPEvents.emit('vp:media:loaded', { duration }, controlsTarget);
});
VPEvents.on('media:ended', ({ targetId }) => {
    if (targetId !== TARGET) return;
    VPEvents.emit('vp:media:ended', {}, controlsTarget);
});
VPEvents.on('media:error', ({ targetId, message }) => {
    if (targetId !== TARGET) return;
    Ubi.log(`[screen] media error: ${message}`, 'warn');
});
