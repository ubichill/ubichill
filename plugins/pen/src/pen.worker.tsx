/**
 * pen:pen Worker — 各ペン Entity の本体。
 *
 * 自身の表示・選択・解放を完結させる。pen-tray はペンの状態を知らない。
 *
 * 責務:
 * - 自分のペンボタン UI をレンダー
 * - クリックで掴む (Ubi.grip.exclusive 経由) / 自分が掴み中なら離す
 * - 他ユーザーが掴み中はグレーアウト
 * - 1 人 1 本ルールは Ubi.grip.exclusive が SDK 側で調停する (pen.worker は意識しない)
 *
 * 状態管理: すべて Ubi.state で宣言的に。
 * - color / strokeWidth: persistent (entity.data と双方向同期)
 * - 占有者:               Ubi.grip.exclusive() が内部で ComponentInstance.lockedBy を同期
 */

import { PenEvents } from './events';

const pen = Ubi.state.define({
    color: Ubi.state.sync('#1a1a1a'),
    strokeWidth: Ubi.state.sync(4),
});

// 1 ユーザー 1 本ルール (同じ pen:pen の中で 1 つだけ掴める) を SDK に委譲。
// emit 調停・acquireEpoch・lockedBy 同期はすべて Ubi.grip 側で処理される。
//
// GripOptions:
//  mode: 'manual'  — クリックで掴む。pen-tray から選びなおすと release() が呼ばれる。
//  hover: grab/grabbing — ペンにマウスを乗せると grab カーソルを表示。
//  offset: { x: -24 } — カーソルの少し左側に表示（自然な持ち方に見える）。
//  share: 'persistent' — lockedBy をサーバー永続化 + cursor:move で他ユーザーにも伝達。
const grip = Ubi.grip.exclusive({
    mode: 'manual',
    hover: { cursor: 'grab', heldCursor: 'grabbing' },
    offset: { x: -24, y: 0 },
    share: 'persistent',
});

// 掴み変化に応じて host へペン色を通知 (avatar カーソルの色変えなど)
grip.onChange((next, prev) => {
    if (next === Ubi.myUserId && prev !== Ubi.myUserId) {
        PenEvents.sendToHost('user:update', { penColor: pen.local.color });
    } else if (prev === Ubi.myUserId && next !== Ubi.myUserId) {
        PenEvents.sendToHost('user:update', { penColor: null });
    }
});

// ── レンダリング (pure: 入力から VNode を構築) ─────────
const renderPen = (): void => {
    const heldBy = grip.holder;
    const isHeldByMe = grip.isMine;
    const isHeldByOther = heldBy !== null && !isHeldByMe;
    const color = pen.local.color;

    Ubi.ui.render(
        () => (
            <button
                type="button"
                title={isHeldByOther ? '使用中' : color}
                disabled={isHeldByOther}
                onUbiClick={() => {
                    if (isHeldByOther) return;
                    if (isHeldByMe) grip.release();
                    else grip.acquire();
                }}
                style={{
                    width: '36px',
                    height: '48px',
                    borderRadius: '8px',
                    border: isHeldByMe ? `2px solid ${color}` : '2px solid transparent',
                    background: isHeldByMe ? `${color}22` : 'rgba(0,0,0,0.04)',
                    cursor: isHeldByOther ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px',
                    transition: 'all 0.15s',
                    opacity: isHeldByOther ? 0.35 : isHeldByMe ? 0.4 : 1,
                    pointerEvents: 'auto',
                }}
            >
                <svg width="18" height="32" viewBox="0 0 18 32" style={{ display: 'block' }}>
                    <polygon points="9,32 5,24 13,24" fill="#888" />
                    <rect
                        x="5"
                        y="4"
                        width="8"
                        height="20"
                        rx="2"
                        fill={color}
                        stroke="rgba(0,0,0,0.2)"
                        strokeWidth="0.8"
                    />
                    <rect x="6" y="6" width="2.5" height="14" rx="1" fill="rgba(255,255,255,0.3)" />
                    <rect x="5" y="1" width="8" height="5" rx="1.5" fill="rgba(0,0,0,0.2)" />
                </svg>
            </button>
        ),
        'pen-button',
    );
};

// 状態変化はすべて onChange で宣言的に再描画
pen.onChange('color', renderPen);
pen.onChange('strokeWidth', renderPen);
grip.onChange(renderPen);

// 初期 1 回レンダー (初期エンティティスナップショットは Ubi.state が反映済み)
renderPen();
