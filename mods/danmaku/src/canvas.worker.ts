/**
 * danmaku:canvas Worker — 弾の描画レイヤー。
 *
 * 自機 (danmaku:player) が emit する `danmaku:shoot` を受け取り、弾をローカルで
 * シミュレーション（上方向に飛行 + 画面外カリング）して毎フレーム Canvas2D に描画する。
 * 弾は揮発的な見た目なので DB 同期はしない（この worker 内で完結）。
 */

import type { ComponentConfig } from '@ubichill/sdk';
import { type Bullet, DanmakuEvents } from './events';

export const config: ComponentConfig = {
    canvasTargets: ['field'],
    defaultTransform: { x: 0, y: 0, z: 5000 },
    capabilities: ['canvas:draw'],
    description: '自機が撃った弾を Canvas2D で描画する。',
};

const CANVAS_TARGET = 'field';
const BULLET_SPEED = 320; // px/秒（上方向）
const CULL_ABOVE = -60; // この y より上に出たら削除

const bullets: Bullet[] = [];

DanmakuEvents.on('danmaku:shoot', ({ x, y }) => {
    bullets.push({ x, y, vx: 0, vy: -BULLET_SPEED });
});

Ubi.registerSystem((_entities, deltaTime) => {
    // 上方向へ進めて画面外をカリング（逆順で回して splice を安全にする）
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * deltaTime;
        b.y += b.vy * deltaTime;
        if (b.y < CULL_ABOVE) bullets.splice(i, 1);
    }

    Ubi.canvas.frame(CANVAS_TARGET, {
        activeStroke: null,
        cursors: bullets.map((b) => ({ x: b.x, y: b.y, color: 'dodgerblue', size: 6 })),
    });
});
