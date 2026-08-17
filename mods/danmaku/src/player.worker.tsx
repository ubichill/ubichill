/**
 * danmaku:player Worker — 自機。
 *
 * 矢印キーで移動し、自分の transform を `Ubi.entity().update` で書き換える(自分自身への
 * 書き込みなので watchScope 制限には掛からない)。被弾は spawner から `Ubi.event.emit`
 * (scope:'world', targetType:'danmaku:player') で通知され、短時間だけ赤く点滅する。
 * Z キーで spawner 狙いの自機弾を発射する (`danmaku:shoot` を emit)。
 */

import type { ComponentConfig, ComponentInstance } from '@ubichill/sdk';
import { DanmakuEvents } from './events';

export const config: ComponentConfig = {
    watchScope: 'entity',
    defaultTransform: { x: 0, y: 0, z: 10, w: 20, h: 20 },
    capabilities: ['scene:read', 'scene:update', 'ui:render', 'event:emit'],
    description: '矢印キーで移動する自機。Zキーで弾を発射しspawnerの弾を避ける。',
};

const SPEED = 160; // px/秒
// ワールド全体ではなく「自機の初期配置」を中心とした相対範囲で可動域を作る。
// ワールドは Editor 上でどこにでも配置できる大きなキャンバスなので、絶対座標で
// クランプすると (a) 初期位置がワールド中央から離れているほど即座に境界へスナップする、
// (b) 可動域がビューポートよりずっと広くなり画面外に出て見失う、という問題が起きる。
const ARENA_HALF_W = 220;
const ARENA_HALF_H = 160;
const SHOOT_INTERVAL = 0.15; // 秒 (Z 押しっぱなし時の連射間隔)

const player = Ubi.state.define({
    // ローカル専用 (同期不要): 被弾フラッシュの表示切替だけに使う
    hit: false,
});

const pressed = new Set<string>();
let transform: ComponentInstance['transform'] | null = null;
let spawnOrigin: { x: number; y: number } | null = null;
let shootCooldown = 0;

if (Ubi.componentInstanceId) {
    Ubi.entity
        .get(Ubi.componentInstanceId)
        .then((self) => {
            if (!self) return;
            transform = { ...self.transform };
            spawnOrigin = { x: self.transform.x, y: self.transform.y };
        })
        .catch((err: unknown) => Ubi.log(`[danmaku:player] 初期位置の取得に失敗: ${String(err)}`, 'warn'));
}

DanmakuEvents.on('input:key_down', ({ code }) => pressed.add(code));
DanmakuEvents.on('input:key_up', ({ code }) => pressed.delete(code));

DanmakuEvents.on('danmaku:hit', () => {
    player.local.hit = true;
    setTimeout(() => {
        player.local.hit = false;
    }, 200);
});

Ubi.registerSystem((_entities, deltaTime) => {
    if (!transform || !spawnOrigin) return;

    let dx = 0;
    let dy = 0;
    if (pressed.has('ArrowLeft')) dx -= 1;
    if (pressed.has('ArrowRight')) dx += 1;
    if (pressed.has('ArrowUp')) dy -= 1;
    if (pressed.has('ArrowDown')) dy += 1;
    if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        transform.x = Math.min(
            Math.max(transform.x + (dx / len) * SPEED * deltaTime, spawnOrigin.x - ARENA_HALF_W),
            spawnOrigin.x + ARENA_HALF_W,
        );
        transform.y = Math.min(
            Math.max(transform.y + (dy / len) * SPEED * deltaTime, spawnOrigin.y - ARENA_HALF_H),
            spawnOrigin.y + ARENA_HALF_H,
        );
        Ubi.entity()
            .update({ transform })
            .catch((err: unknown) => Ubi.log(`[danmaku:player] 移動の反映に失敗: ${String(err)}`, 'warn'));
    }

    shootCooldown -= deltaTime;
    if (pressed.has('KeyZ') && shootCooldown <= 0) {
        shootCooldown = SHOOT_INTERVAL;
        DanmakuEvents.emit(
            'danmaku:shoot',
            { x: transform.x + 10, y: transform.y + 10 },
            { scope: 'world', targetType: 'danmaku:spawner' },
        );
    }
});

// Shadow DOM の中間ラッパーが高さ auto のため、% 指定は高さが潰れる (pen mod と同様に px 固定にする)。
export default function PlayerView() {
    return (
        <div
            style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: player.local.hit ? '#ff4d4f' : '#4d9dff',
                border: '2px solid rgba(255,255,255,0.85)',
                boxShadow: '0 0 6px rgba(0,0,0,0.4)',
            }}
        />
    );
}
