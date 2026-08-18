/**
 * danmaku:player Worker — 自機。
 *
 * 矢印キーで移動し、自分の transform を `Ubi.entity().update` で書き換える(自分自身への
 * 書き込みなので watchScope 制限には掛からない)。Z キー（または自動連射）で上方向に弾を撃つ。
 * 弾のシミュレーション・描画は danmaku:canvas が担う（自機は発射通知を emit するだけ）。
 *
 * UdonScript の public 変数のように、速度 / 発射レート / 弾速 / 自動連射 を Inspector で
 * 設定できる（config.dataFields + Ubi.state.sync）。
 */

import { CORE_COMPONENT_TYPES, type ColliderData, type ComponentConfig, type ComponentInstance } from '@ubichill/sdk';
import { type ColliderInstance, collidesWithSolid, PLAYER_COLLIDER } from './collision';
import { DanmakuEvents } from './events';

export const config: ComponentConfig = {
    // Host管理のdata-only Colliderだけをworld全体から読む。UIや他modの内部状態は購読しない。
    watchScope: 'world',
    watchEntityTypes: ['core:collider'],
    // x/y は指定しない（Entity の位置を継承）。w/h/z だけ上書きする。
    defaultTransform: { z: 10, w: 20, h: 20 },
    dataFields: {
        speed: { type: 'number', default: 160, min: 20, max: 600, step: 10, label: '移動速度 (px/秒)' },
        fireRate: { type: 'number', default: 6, min: 1, max: 30, step: 1, label: '発射レート (発/秒)' },
        bulletSpeed: { type: 'number', default: 320, min: 50, max: 1000, step: 10, label: '弾速 (px/秒)' },
        autoFire: { type: 'boolean', default: false, label: '自動連射' },
    },
    capabilities: ['scene:read', 'scene:update', 'ui:render', 'event:emit'],
    description: '矢印キーで移動し、Zキー（または自動）で上方向に弾を撃つ自機。',
};

const player = Ubi.state.define({
    speed: Ubi.state.sync(160, { type: 'number', min: 20, max: 600, step: 10, label: '移動速度 (px/秒)' }),
    fireRate: Ubi.state.sync(6, { type: 'number', min: 1, max: 30, step: 1, label: '発射レート (発/秒)' }),
    bulletSpeed: Ubi.state.sync(320, { type: 'number', min: 50, max: 1000, step: 10, label: '弾速 (px/秒)' }),
    autoFire: Ubi.state.sync(false, { type: 'boolean', label: '自動連射' }),
});

const pressed = new Set<string>();
let transform: ComponentInstance['transform'] | null = null;
let collider: ColliderData = PLAYER_COLLIDER;
let worldColliders: ColliderInstance[] = [];
let shootCooldown = 0;

if (Ubi.componentInstanceId) {
    Promise.all([
        Ubi.entity.get(Ubi.componentInstanceId),
        Ubi.entity.query<ColliderData>(CORE_COMPONENT_TYPES.collider),
    ])
        .then(([self, colliders]) => {
            if (self) transform = { ...self.transform };
            worldColliders = colliders;
            const ownCollider = colliders.find((candidate) => candidate.entityId === Ubi.entityId);
            if (ownCollider) collider = ownCollider.data;
        })
        .catch((err: unknown) => Ubi.log(`[danmaku:player] 初期状態の取得に失敗: ${String(err)}`, 'warn'));
}

DanmakuEvents.on('input:key_down', ({ code }) => pressed.add(code));
DanmakuEvents.on('input:key_up', ({ code }) => pressed.delete(code));

Ubi.registerSystem((_entities, deltaTime) => {
    if (!transform) return;

    // deltaTime はミリ秒（Host の TickController が経過 ms を渡す）なので秒に変換する。
    const dt = deltaTime / 1000;

    let dx = 0;
    let dy = 0;
    if (pressed.has('ArrowLeft')) dx -= 1;
    if (pressed.has('ArrowRight')) dx += 1;
    if (pressed.has('ArrowUp')) dy -= 1;
    if (pressed.has('ArrowDown')) dy += 1;
    if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        const moveX = (dx / len) * player.local.speed * dt;
        const moveY = (dy / len) * player.local.speed * dt;

        // 軸ごとに判定することで、斜め入力で壁に当たっても壁沿いに滑れる。
        const nextX = { ...transform, x: transform.x + moveX };
        if (!collidesWithSolid(nextX, collider, worldColliders, Ubi.entityId)) transform.x = nextX.x;
        const nextY = { ...transform, y: transform.y + moveY };
        if (!collidesWithSolid(nextY, collider, worldColliders, Ubi.entityId)) transform.y = nextY.y;
        Ubi.entity()
            .update({ transform })
            .catch((err: unknown) => Ubi.log(`[danmaku:player] 移動の反映に失敗: ${String(err)}`, 'warn'));
    }

    shootCooldown -= dt;
    const wantsShoot = player.local.autoFire || pressed.has('KeyZ');
    if (wantsShoot && shootCooldown <= 0) {
        shootCooldown = 1 / Math.max(player.local.fireRate, 0.1);
        // 自機の先端（中央上）から上方向に撃つ。弾速は Inspector の設定値を使う。
        DanmakuEvents.emit(
            'danmaku:shoot',
            { x: transform.x + 10, y: transform.y, speed: player.local.bulletSpeed },
            { scope: 'world', targetType: 'danmaku:canvas' },
        );
    }
});

export default function PlayerView() {
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                borderRadius: '50%',
                background: '#4d9dff',
                border: '2px solid rgba(255,255,255,0.85)',
                // Entity transform はclipではないため、光彩は当たり判定の外へ描ける。
                boxShadow: '0 0 12px rgba(56,189,248,.95), 0 0 6px rgba(0,0,0,.5)',
            }}
        />
    );
}
