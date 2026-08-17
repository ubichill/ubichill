/**
 * danmaku:spawner Worker — 弾の発生源(見た目は持たない)。
 *
 * `target` (entityRef) で指定した danmaku:player Entity を狙って弾を撃つ。プレイヤーは
 * watchScope 外の別 Entity なので、通常の scope では読めない — entityRef で明示配線した
 * 対象だけを読める Stage B の declaredTargets 拡張を使う実例。
 *
 * 弾のシミュレーション自体は毎 tick 行うが、兄弟 (danmaku:canvas) へ公開する
 * `bullets` state への反映は間引く (DB 書き込み過多を避けるため)。
 */

import type { ComponentConfig } from '@ubichill/sdk';
import { type Bullet, DanmakuEvents } from './events';

export const config: ComponentConfig = {
    watchScope: 'entity',
    defaultTransform: { x: 0, y: 0, z: 1, w: 16, h: 16 },
    dataFields: {
        target: { type: 'entityRef', label: '狙う相手 (プレイヤー)' },
        bulletsPerSecond: { type: 'number', default: 2, min: 0.5, max: 10, step: 0.5, label: '発射レート (発/秒)' },
        bulletSpeed: { type: 'number', default: 120, min: 20, max: 400, step: 10, label: '弾速 (px/秒)' },
    },
    capabilities: ['scene:read', 'scene:update', 'event:emit'],
    // renderKind 未指定 = ロジックのみ (見た目は兄弟の danmaku:canvas が担う)
    description: 'entityRefで指定したプレイヤーを狙って弾を撃つ。見た目は持たず canvas が描画する。',
};

const PLAYER_TYPE = 'danmaku:player';
const HIT_RADIUS = 14;
const PLAYER_POLL_INTERVAL = 0.2; // 秒 (プレイヤー位置の再取得間隔)
const BULLET_PUBLISH_INTERVAL = 0.15; // 秒 (兄弟への state 公開間隔)
// ワールドの既定サイズ (DEFAULTS.WORLD_ENVIRONMENT.worldSize) に合わせる。
// player.worker.tsx と同じ理由で、狭い値だと spawner 自体の既定配置よりも
// 内側になってしまい、生成した弾が初回 tick で即座に削除されてしまう。
const WORLD_W = 2000;
const WORLD_H = 1500;
const WORLD_MARGIN = 40; // これを超えて出た弾は削除

const spawner = Ubi.state.define({
    target: Ubi.state.sync<string | null>(null, { type: 'entityRef', label: '狙う相手 (プレイヤー)' }),
    bulletsPerSecond: Ubi.state.sync(2, { type: 'number', min: 0.5, max: 10, step: 0.5, label: '発射レート (発/秒)' }),
    bulletSpeed: Ubi.state.sync(120, { type: 'number', min: 20, max: 400, step: 10, label: '弾速 (px/秒)' }),
    // 実行時の内部状態。Inspector には出さず canvas 兄弟への公開専用。
    bullets: Ubi.state.sync<Bullet[]>([], { editable: false }),
});

let origin: { x: number; y: number } | null = null;
let playerPos: { x: number; y: number } | null = null;
let simBullets: Bullet[] = [];
let spawnTimer = 0;
let playerPollTimer = 0;
let publishTimer = 0;
let nextBulletId = 0;

if (Ubi.componentInstanceId) {
    Ubi.entity
        .get(Ubi.componentInstanceId)
        .then((self) => {
            if (self) origin = { x: self.transform.x, y: self.transform.y };
        })
        .catch((err: unknown) => Ubi.log(`[danmaku:spawner] 自位置の取得に失敗: ${String(err)}`, 'warn'));
}

async function refreshPlayerPos(): Promise<void> {
    const targetId = spawner.local.target;
    if (!targetId) return;
    try {
        const players = await Ubi.entity.query(PLAYER_TYPE);
        const found = players.find((p) => p.entityId === targetId);
        if (found) playerPos = { x: found.transform.x + 10, y: found.transform.y + 10 };
    } catch (err) {
        Ubi.log(`[danmaku:spawner] プレイヤー位置の取得に失敗: ${String(err)}`, 'warn');
    }
}

function spawnBullet(): void {
    if (!origin || !playerPos) return;
    const dx = playerPos.x - origin.x;
    const dy = playerPos.y - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = spawner.local.bulletSpeed;
    simBullets.push({
        id: `b${nextBulletId++}`,
        x: origin.x,
        y: origin.y,
        vx: (dx / len) * speed,
        vy: (dy / len) * speed,
    });
}

function checkHit(): boolean {
    if (!playerPos) return false;
    const p = playerPos;
    const before = simBullets.length;
    simBullets = simBullets.filter((b) => Math.hypot(b.x - p.x, b.y - p.y) > HIT_RADIUS);
    return simBullets.length < before;
}

Ubi.registerSystem((_entities, deltaTime) => {
    if (!origin) return;

    playerPollTimer += deltaTime;
    if (playerPollTimer >= PLAYER_POLL_INTERVAL) {
        playerPollTimer = 0;
        void refreshPlayerPos();
    }

    spawnTimer += deltaTime;
    const interval = 1 / Math.max(spawner.local.bulletsPerSecond, 0.1);
    if (spawnTimer >= interval) {
        spawnTimer -= interval;
        spawnBullet();
    }

    simBullets = simBullets
        .map((b) => ({ ...b, x: b.x + b.vx * deltaTime, y: b.y + b.vy * deltaTime }))
        .filter(
            (b) =>
                b.x > -WORLD_MARGIN &&
                b.x < WORLD_W + WORLD_MARGIN &&
                b.y > -WORLD_MARGIN &&
                b.y < WORLD_H + WORLD_MARGIN,
        );

    if (checkHit()) {
        DanmakuEvents.emit('danmaku:hit', {}, { scope: 'world', targetType: 'danmaku:player' });
    }

    publishTimer += deltaTime;
    if (publishTimer >= BULLET_PUBLISH_INTERVAL) {
        publishTimer = 0;
        spawner.local.bullets = simBullets;
    }
});
