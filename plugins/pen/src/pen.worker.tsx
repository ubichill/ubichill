/**
 * pen:pen Worker — ペン本体。
 *
 * **責務はシンプル: 自分の見た目 + 持って書ける宣言だけ**。
 *  - hover / click → acquire / release / カーソル追従 / 1 ユーザー 1 本ルール:
 *    すべて Ubi.grip + <Gripable> が SDK 側で自動処理する
 *  - 線の太さ調整は held 中だけ表示される小さなポップオーバー
 *  - ペン本体の状態 (color, strokeWidth) のみ永続同期
 *
 * tray はもうペンの状態を一切知らない (単なる置き場の枠)。
 */

import { Gripable } from '@ubichill/sdk/gripable';
import { PenEvents } from './events';

const pen = Ubi.state.define({
    color: Ubi.state.sync('#1a1a1a'),
    strokeWidth: Ubi.state.sync(4),
});

// 「持って書ける」宣言。クリック / hover / 追従 / 1 本ルールは全部 SDK 任せ。
const grip = Ubi.grip.exclusive({
    mode: 'toggle',
    hover: {
        cursor: 'grab',
        heldCursor: 'grabbing',
        outline: '2px solid currentColor',
        scale: 1.05,
    },
    held: { opacity: 0.4 },
    blockedByOther: { opacity: 0.35 },
    offset: { x: -24, y: 0 },
    share: 'persistent',
});

// 持ち / 離しに応じて自分の penColor を Host へ通知 (avatar カーソルの色変えなどに使う)
grip.onChange((next, prev) => {
    if (next === Ubi.myUserId && prev !== Ubi.myUserId) {
        PenEvents.sendToHost('user:update', { penColor: pen.local.color });
    } else if (prev === Ubi.myUserId && next !== Ubi.myUserId) {
        PenEvents.sendToHost('user:update', { penColor: null });
    }
});

// ── 線の太さ調整ポップオーバー (held 中だけ表示) ────────────
const SIZES = [2, 4, 8, 16] as const;

function renderSizePopover(): void {
    if (!grip.isMine) {
        Ubi.ui.unmount('pen-size-popover');
        return;
    }
    const current = pen.local.strokeWidth;
    const color = pen.local.color;
    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'fixed',
                    top: '24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    gap: '6px',
                    padding: '6px 8px',
                    background: 'rgba(255,255,255,0.96)',
                    borderRadius: '24px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    pointerEvents: 'auto',
                    zIndex: 10000,
                }}
            >
                {SIZES.map((s) => {
                    const isSelected = current === s;
                    return (
                        <button
                            key={String(s)}
                            type="button"
                            title={`${s}px`}
                            onUbiClick={() => {
                                pen.local.strokeWidth = s;
                            }}
                            style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                border: isSelected ? `2px solid ${color}` : '2px solid rgba(0,0,0,0.12)',
                                background: isSelected ? `${color}22` : 'transparent',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '0',
                                transition: 'all 0.12s',
                            }}
                        >
                            <div
                                style={{
                                    width: Math.min(s * 1.5, 14),
                                    height: Math.min(s * 1.5, 14),
                                    borderRadius: '50%',
                                    background: isSelected ? color : 'rgba(0,0,0,0.4)',
                                }}
                            />
                        </button>
                    );
                })}
            </div>
        ),
        'pen-size-popover',
    );
}

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
                    }}
                >
                    <PenSvg color={color} />
                </div>
            </Gripable>
        ),
        'pen-button',
    );
    renderSizePopover();
}

// 状態変化はすべて onChange で宣言的に再描画
pen.onChange('color', renderPen);
pen.onChange('strokeWidth', renderPen);
grip.onChange(renderPen);

// 初期 1 回レンダー
renderPen();
