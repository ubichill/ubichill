/**
 * video-player Worker 間通信の単一スキーマ。
 *
 * 全 Worker (controls / screen / playlist / search) が同じ schema を import するので
 * type 文字列の typo と payload 不一致はコンパイル時に弾かれる。
 *
 * `Ubi.event.define()` は呼び出し Worker 内に閉じた registry を作る (handlers は
 * Worker ローカル)。各 Worker が独立にこのモジュールを評価し、各々の Ubi 経由で
 * 新しいインスタンスを得る — シングルトンではない。
 */

import type { LoopMode, Track } from './types';

type Empty = Record<string, never>;

export const VPEvents = Ubi.event.define<{
    // ── controls → screen (再生コマンド) ──
    'vp:media:load': { url: string; mode: 'live' | 'video' };
    'vp:media:play': Empty;
    'vp:media:pause': Empty;
    'vp:media:seek': { time: number };
    'vp:media:volume': { volume: number };
    // ── screen → controls (<video> 要素の状態通知) ──
    'vp:media:time': { currentTime: number; duration: number };
    'vp:media:loaded': { duration: number };
    'vp:media:ended': Empty;
    // ── controls → playlist (トラック操作) ──
    'vp:track:next': { loop: LoopMode; shuffle: boolean };
    'vp:track:prev': Empty;
    'vp:track:remove': { index: number };
    // ── playlist → siblings (現トラック通知) ──
    'vp:track:current': { track: Track | null; index: number; total: number };
    // ── search → playlist (新規トラック追加) ──
    'vp:track:add': { track: Track };
    // ── playlist → controls (末尾到達による再生停止) ──
    'vp:playback:stop': Empty;
    // ── Ubi.media SDK 由来 (DOM <video> イベント) ──
    'media:timeUpdate': { targetId: string; currentTime: number; duration: number };
    'media:loaded': { targetId: string; duration: number };
    'media:ended': { targetId: string };
    'media:error': { targetId: string; message: string };
}>();
