/**
 * pen:pen Worker — ペン本体。
 *
 * **責務はシンプル: 自分の見た目 + 持って書ける宣言だけ**。
 *  - hover / click → acquire / カーソル追従 / 1 ユーザー 1 本ルール:
 *    すべて Ubi.grip + <Gripable> が SDK 側で自動処理する
 *  - release は **tray クリックでのみ** 発火する (mode='manual')。
 *    持ったままどこかをクリックしても release されない (pen は cursor 追従で
 *    画面のどこにいても "pen をクリック" と判定されうるため toggle は NG)
 *  - ペン本体の状態 (color, strokeWidth) のみ永続同期
 *
 * 太さ調整 UI は pen-tray が持つ (tray.worker.tsx)。pen 自身は見た目だけ。
 */

import type { ComponentConfig } from 'ubichill';
import { Gripable } from 'ubichill/gripable';
import { PenEvents } from './events';
import { GRIP_OFFSET, HELD_ROTATION_DEG, PEN_BOX, strokePointFor } from './penTip';

export const config: ComponentConfig = {
    watchEntityTypes: ['pen:pen'],
    watchScope: 'entity',
    defaultTransform: { x: 0, y: 0, z: 1, w: 36, h: 48 },
    dataFields: {
        color: { type: 'color', default: '#1a1a1a', label: 'ペンの色' },
        strokeWidth: { type: 'number', default: 4, min: 1, max: 30, step: 1, label: '線の太さ' },
    },
    capabilities: ['event:emit', 'host:message', 'scene:read', 'scene:update', 'ui:render'],
};

const pen = Ubi.state.define({
    color: Ubi.state.sync('#1a1a1a'),
    strokeWidth: Ubi.state.sync(4),
});

// 「持って書ける」宣言。クリック / hover / 追従 / 1 本ルールは全部 SDK 任せ。
// mode='manual': acquire は click で発火、release は明示的呼び出しのみ。
// pen を持ったままどこかをクリックしても自分 click と判定されて release されないように。
const grip = Ubi.grip.exclusive({
    mode: 'manual',
    hover: {
        cursor: 'grab',
        heldCursor: 'grabbing',
        scale: 1.15,
    },
    blockedByOther: { opacity: 0.35 },
    // どう持つか。線がどこから出るかはこの値と独立に penTip が決めるので、
    // ここを変えても線はペン先から出る（既定はペン先が指の位置に来る持ち方）。
    offset: GRIP_OFFSET,
    share: 'persistent',
    // 持った時に他のペンより手前に。リリース後もこの z は永続するので
    // 「最後に触ったペンが一番上」状態が保たれて子要素間の z が逆転しない
    bringToFront: true,
});

// tray クリック → 持っているペンを離して tray のクリック位置に置く
PenEvents.on('pen:tray:release', (coords) => {
    if (grip.isMine) grip.release(coords);
});

// ── 描画点の送出 ──────────────────────────────────────────
// ペンの形状・持ち方を知っているのはペン本体だけなので、ペン先の座標はここで求めて canvas へ送る。
// canvas 側がカーソル座標から描くと、持ち方や見た目を変えた瞬間に線とペン先がずれる。
const toCanvas = { scope: 'world', targetType: 'pen:canvas' } as const;
let isDrawing = false;

PenEvents.on('input:mouse_down', ({ x, y, button }) => {
    if (!grip.isMine || button !== 0) return;
    isDrawing = true;
    PenEvents.emit('pen:draw:down', strokePointFor({ x, y }), toCanvas);
});

PenEvents.on('input:mouse_move', ({ x, y, buttons }) => {
    if (!isDrawing || !grip.isMine || !(buttons & 1)) return;
    PenEvents.emit('pen:draw:move', strokePointFor({ x, y }), toCanvas);
});

PenEvents.on('input:mouse_up', ({ button }) => {
    if (!isDrawing || button !== 0) return;
    isDrawing = false;
    PenEvents.emit('pen:draw:up', {}, toCanvas);
});

// 手放したら描画も止める（離した瞬間に線が伸び続けないように）
grip.onChange(() => {
    if (grip.isMine || !isDrawing) return;
    isDrawing = false;
    PenEvents.emit('pen:draw:up', {}, toCanvas);
});

// tray での太さ変更 → 自分が持っているペンなら太さを反映する
PenEvents.on('pen:tray:change_thickness', ({ thickness }) => {
    if (grip.isMine) {
        pen.local.strokeWidth = thickness;
    }
});

// ── ペン本体のレンダリング ──────────────────────────────────
const PenSvg = ({ color }: { color: string }) => (
    <svg width="18" height="32" viewBox="0 0 18 32" style={{ display: 'block' }}>
        <polygon points="9,32 5,24 13,24" fill="#888" />
        <rect x="5" y="4" width="8" height="20" rx="2" fill={color} stroke="rgba(0,0,0,0.2)" strokeWidth="0.8" />
        <rect x="6" y="6" width="2.5" height="14" rx="1" fill="rgba(255,255,255,0.3)" />
        <rect x="5" y="1" width="8" height="5" rx="1.5" fill="rgba(0,0,0,0.2)" />
    </svg>
);

// export default = このComponentの唯一のUI。ビルド時にバンドルされ、Sandbox が起動時に
// 一度だけ自動で Ubi.ui.render(default) する（手動の初期呼び出しは不要）。
// ここで読む pen.local.color / grip.isMine（内部的に Ubi.state 経由）は自動で依存追跡され、
// 変化時だけ自動的に再実行される。onChange の手動結線は不要（strokeWidth はここで読んで
// いないので、変わっても再描画されない）。
export default function PenView() {
    return (
        <Gripable grip={grip} style={{ color: pen.local.color, width: `${PEN_BOX.w}px`, height: `${PEN_BOX.h}px` }}>
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: grip.isMine ? `rotate(${HELD_ROTATION_DEG}deg)` : 'none',
                    transformOrigin: 'bottom right',
                    transition: 'transform 0.15s ease',
                }}
            >
                <PenSvg color={pen.local.color} />
            </div>
        </Gripable>
    );
}
