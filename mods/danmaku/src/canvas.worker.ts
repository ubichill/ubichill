/**
 * danmaku:canvas Worker — 弾幕の描画レイヤー。
 *
 * 兄弟 (同一 Entity 上の danmaku:spawner) が公開する `bullets` state を
 * `entity:danmaku:spawner` イベントで受け取り、`Ubi.canvas.frame` で毎フレーム描画する。
 * spawner とは同じ Entity 上の兄弟なので watchScope='entity' の通常の可視範囲で読める
 * (entityRef は使わない — こちらは「1 Entity に複数 Component」の実演)。
 */

import type { ComponentConfig } from '@ubichill/sdk';
import { DanmakuEvents } from './events';

export const config: ComponentConfig = {
    canvasTargets: ['field'],
    watchEntityTypes: ['danmaku:spawner'],
    watchScope: 'entity',
    defaultTransform: { x: 0, y: 0, z: 5000 },
    capabilities: ['canvas:draw'],
    description: '兄弟の danmaku:spawner が持つ弾のリストを Canvas2D で描画する。',
};

const CANVAS_TARGET = 'field';

let bulletPoints: Array<{ x: number; y: number }> = [];
let playerShotPoints: Array<{ x: number; y: number }> = [];

DanmakuEvents.on('entity:danmaku:spawner', (spawner) => {
    bulletPoints = (spawner?.data.bullets ?? []).map((b) => ({ x: b.x, y: b.y }));
    playerShotPoints = (spawner?.data.playerShots ?? []).map((b) => ({ x: b.x, y: b.y }));
});

Ubi.registerSystem(() => {
    Ubi.canvas.frame(CANVAS_TARGET, {
        activeStroke: null,
        cursors: [
            ...bulletPoints.map((p) => ({ x: p.x, y: p.y, color: 'crimson', size: 8 })),
            ...playerShotPoints.map((p) => ({ x: p.x, y: p.y, color: 'dodgerblue', size: 6 })),
        ],
    });
});
