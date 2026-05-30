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

import { Gripable } from '@ubichill/sdk/gripable';
import { PenEvents } from './events';

const pen = Ubi.state.define({
    color: Ubi.state.sync('#1a1a1a'),
    strokeWidth: Ubi.state.sync(4),
});

// 「持って書ける」宣言。クリック / hover / 追従 / 1 本ルールは全部 SDK 任せ。
// mode='manual': acquire は click で発火、release は明示的呼び出しのみ。
// pen を持ったままどこかをクリックしても自分 click と判定されて release されないように。
const grip = Ubi.grip.exclusive({
    mode: 'toggle',
    hover: {
        cursor: 'grab',
        heldCursor: 'grabbing',
        outline: '2px solid currentColor',
        scale: 1.15,
    },
    held: { opacity: 0.4 },
    blockedByOther: { opacity: 0.35 },
    offset: { x: -18, y: -24 },
    share: 'persistent',
});

// tray での太さ変更 → 自分が持っているペンなら太さを反映する
PenEvents.on('pen:tray:change_thickness', ({ thickness }) => {
    if (grip.isMine) {
        pen.local.strokeWidth = thickness;
    }
});

// 持ち / 離しに応じて自分の penColor を Host へ通知 (avatar カーソルの色変えなどに使う)
grip.onChange((next, prev) => {
    if (next === Ubi.myUserId && prev !== Ubi.myUserId) {
        PenEvents.sendToHost('user:update', { penColor: pen.local.color });
    } else if (prev === Ubi.myUserId && next !== Ubi.myUserId) {
        PenEvents.sendToHost('user:update', { penColor: null });
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

function renderPen(): void {
    const color = pen.local.color;
    Ubi.ui.render(
        () => (
            <Gripable grip={grip} style={{ color, width: '36px', height: '48px' }}>
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: grip.isMine ? 'rotate(-30deg)' : 'none',
                        transformOrigin: 'bottom right',
                        transition: 'transform 0.15s ease',
                    }}
                >
                    <PenSvg color={color} />
                </div>
            </Gripable>
        ),
        'pen-button',
    );
}

// 状態変化はすべて onChange で宣言的に再描画
pen.onChange('color', renderPen);
pen.onChange('strokeWidth', renderPen);
grip.onChange(renderPen);

// 初期 1 回レンダー
renderPen();
