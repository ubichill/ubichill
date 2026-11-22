/**
 * danmaku:enemy — 敵 1 体の設定だけを持つ Component（Worker は持たない）。
 *
 * 遊ぶ範囲（danmaku:canvas）の中に置くと、範囲がステージとして動かす。Entity の位置が敵の定位置、
 * 大きさが当たりの大きさになる。いつ現れていつ去るか・どう動くか・どう撃つかを設定欄で決める。
 * このファイルはバンドルも実行もされない（config だけが manifest に載る）。読み方は game/enemy.ts。
 */

import type { ComponentConfig } from 'ubichill';

export const config: ComponentConfig = {
    dataOnly: true,
    defaultTransform: { z: 20, w: 40, h: 40 },
    thumbnail: 'previews/enemy.svg',
    description:
        '弾幕の敵。遊ぶ範囲（danmaku:canvas）の中に置く。ラウンドが始まってから現れるまでの秒・去るまでの秒・動き方・弾の撃ち方を決める。',
    dataFields: {
        hp: { type: 'number', default: 20, min: 1, max: 999, step: 1, label: 'HP', help: '自機の弾 1 発で 1 減る' },
        appearAt: {
            type: 'number',
            default: 0,
            min: 0,
            max: 3600,
            step: 0.5,
            label: '現れる (秒)',
            help: 'ラウンドが始まってから、上から降りてくるまでの秒',
        },
        leaveAt: {
            type: 'number',
            default: 0,
            min: 0,
            max: 3600,
            step: 0.5,
            label: '去る (秒)',
            help: 'ラウンドが始まってから、上へ去るまでの秒。0 なら倒されるまで居続ける',
        },
        motion: {
            type: 'enum',
            default: 'sway',
            options: ['none', 'sway', 'circle'],
            label: '動き',
            help: 'none は止まる、sway は左右に揺れる、circle は円を描く',
        },
        range: { type: 'number', default: 80, min: 0, max: 400, step: 10, label: '動く幅 (px)' },
        period: { type: 'number', default: 4, min: 0.5, max: 60, step: 0.5, label: '動きの周期 (秒)' },
        pattern: {
            type: 'enum',
            default: 'radial',
            options: ['radial', 'spiral', 'aimed', 'rain'],
            label: '撃ち方',
            help: 'radial は全方向の輪、spiral は回る渦、aimed は自機を狙う扇、rain は下へばらまく雨',
        },
        count: { type: 'number', default: 12, min: 1, max: 64, step: 1, label: '1 回の弾の数' },
        interval: { type: 'number', default: 1, min: 0.05, max: 10, step: 0.05, label: '撃つ間隔 (秒)' },
        bulletSpeed: { type: 'number', default: 120, min: 20, max: 600, step: 10, label: '弾速 (px/秒)' },
        spread: {
            type: 'number',
            default: 30,
            min: 0,
            max: 360,
            step: 1,
            label: '角度 (度)',
            help: 'aimed は扇の広さ、rain はばらまく広さ、spiral は 1 回ごとに回る角度',
        },
        color: { type: 'color', default: '#f472b6', label: '色' },
    },
};
