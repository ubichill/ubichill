/**
 * danmaku mod Worker 間通信の単一スキーマ。
 *
 * - on()   : emit / SDK 由来 (input:* など) を受信
 * - emit() : 同 tab 内の他 Worker へ scope + targetType を指定して送信
 */

import type { InputKeyDownData, InputKeyUpData } from '@ubichill/sdk';

/** 自機が撃った弾（danmaku:canvas がローカルでシミュレーション・描画する）。 */
export interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

export const DanmakuEvents = Ubi.event.define<{
    // ── SDK 由来: キー入力 (input:*) ──
    'input:key_down': InputKeyDownData;
    'input:key_up': InputKeyUpData;
    // ── 自mod: 自機 → canvas への発射通知 (emit, scope:'world', targetType:'danmaku:canvas') ──
    'danmaku:shoot': { x: number; y: number; speed: number };
}>();
