/**
 * danmaku mod Worker 間通信の単一スキーマ。
 *
 * - on()   : emit / SDK 由来 (input:* / entity:* など) を受信
 * - emit() : 同 tab 内の他 Worker へ scope + targetType を指定して送信
 */

import type { ComponentInstance, InputKeyDownData, InputKeyUpData } from '@ubichill/sdk';

/** スポナーが管理する 1 発の弾。 */
export interface Bullet {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

export interface SpawnerData {
    bullets?: Bullet[];
}

export const DanmakuEvents = Ubi.event.define<{
    // ── SDK 由来: キー入力 (input:*) ──
    'input:key_down': InputKeyDownData;
    'input:key_up': InputKeyUpData;
    // ── SDK 由来: Entity watch (entity:<componentType>) ──
    'entity:danmaku:spawner': ComponentInstance<SpawnerData> | undefined;
    // ── 自mod: スポナー → プレイヤーへの被弾通知 (emit, scope:'world') ──
    'danmaku:hit': Record<string, never>;
}>();
