/**
 * danmaku:player Worker — 自機。
 *
 * 矢印キーで移動し、自分の transform を `Ubi.entity().update` で書き換える(自分自身への
 * 書き込みなので watchScope 制限には掛からない)。被弾は spawner から `Ubi.event.emit`
 * (scope:'world', targetType:'danmaku:player') で通知され、短時間だけ赤く点滅する。
 */

import type { ComponentConfig, ComponentInstance } from '@ubichill/sdk';
import { DanmakuEvents } from './events';

export const config: ComponentConfig = {
    watchScope: 'entity',
    defaultTransform: { x: 0, y: 0, z: 10, w: 20, h: 20 },
    capabilities: ['scene:read', 'scene:update', 'ui:render'],
    renderKind: 'jsx',
    description: '矢印キーで移動する自機。spawnerの弾を避ける。',
};

const SPEED = 160; // px/秒
// ワールドの既定サイズ (DEFAULTS.WORLD_ENVIRONMENT.worldSize) に合わせる。
// Editor 上でのデフォルト配置はこの範囲内にあるため、狭い値にすると
// 最初のキー入力で即座に境界へスナップしてしまう。
const WORLD_W = 2000;
const WORLD_H = 1500;

const player = Ubi.state.define({
    // ローカル専用 (同期不要): 被弾フラッシュの表示切替だけに使う
    hit: false,
});

const pressed = new Set<string>();
let transform: ComponentInstance['transform'] | null = null;

if (Ubi.componentInstanceId) {
    Ubi.entity
        .get(Ubi.componentInstanceId)
        .then((self) => {
            if (self) transform = { ...self.transform };
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
    if (!transform) return;
    let dx = 0;
    let dy = 0;
    if (pressed.has('ArrowLeft')) dx -= 1;
    if (pressed.has('ArrowRight')) dx += 1;
    if (pressed.has('ArrowUp')) dy -= 1;
    if (pressed.has('ArrowDown')) dy += 1;
    if (dx === 0 && dy === 0) return;

    const len = Math.hypot(dx, dy) || 1;
    transform.x = Math.min(Math.max(transform.x + (dx / len) * SPEED * deltaTime, 0), WORLD_W - 20);
    transform.y = Math.min(Math.max(transform.y + (dy / len) * SPEED * deltaTime, 0), WORLD_H - 20);

    Ubi.entity()
        .update({ transform })
        .catch((err: unknown) => Ubi.log(`[danmaku:player] 移動の反映に失敗: ${String(err)}`, 'warn'));
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
