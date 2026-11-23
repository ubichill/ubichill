/**
 * danmaku mod Worker 間通信の単一スキーマ。
 *
 * - on()          : emit / SDK 由来 (input:* / entity:* など) を受信
 * - emit()        : 同 tab 内の他 Worker へ scope + targetType を指定して送信
 * - broadcast()   : 部屋のほかの人の、同じ Entity の Worker へ送る
 */

import type { ComponentInstance, InputKeyDownData, InputKeyUpData } from 'ubichill';

/** 自機 → 範囲: 弾を撃った。mine はこの画面の人が撃った弾（当たりを数えるのは撃った人だけ）。 */
export interface ShootMessage {
    x: number;
    y: number;
    speed: number;
    mine: boolean;
}

/** 自機 → 範囲: 自分が乗っている自機の当たり判定（毎フレーム。撃墜中は送らない）。 */
export interface ShipMessage {
    shipId: string;
    x: number;
    y: number;
    hitRadius: number;
    /** 無敵の間は false（当たっても知らせない）。 */
    vulnerable: boolean;
}

export const DanmakuEvents = Ubi.event.define<{
    // ── SDK 由来: キー入力 (input:*) ──
    'input:key_down': InputKeyDownData;
    'input:key_up': InputKeyUpData;
    // ── mobile-controller mod 由来: 仮想パッドのボタン押下/解放 (同Entity, scope:'subtree') ──
    // 実装は import せず、鍵入力と同じ shape の規約でのみ結合する (zero-trust)。
    'mobile:key_down': { code: string };
    'mobile:key_up': { code: string };
    // ── SDK 由来: watchEntityTypes の Entity が変わった ──
    'entity:danmaku:canvas': ComponentInstance;
    'entity:danmaku:enemy': ComponentInstance;
    'entity:danmaku:player': ComponentInstance;
    // ── 自機 → 範囲 (emit, scope:'world', targetType:'danmaku:canvas') ──
    'danmaku:shoot': ShootMessage;
    'danmaku:ship': ShipMessage;
    /** 自機に乗った。ほかに乗っている人がいなければ、範囲は新しいラウンドを始める。 */
    'danmaku:board': { shipId: string };
    // ── 範囲 → 自機 (emit, scope:'world', targetType:'danmaku:player') ──
    'danmaku:hit': { shipId: string };
    // ── 自機 → ほかの人の同じ自機 (broadcast) ──
    'danmaku:shot': { x: number; y: number; speed: number };
}>();
