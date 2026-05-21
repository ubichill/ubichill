/**
 * pen:pen Worker — 各ペン Entity の本体。
 *
 * 自身の表示・選択・解放を完結させる。pen-tray はペンの状態を知らない。
 *
 * 責務:
 * - 自分のペンボタン UI をレンダー
 * - クリックで選択 (lockedBy=me) / 自分が選択中なら解放
 * - 他ユーザーが保持中はグレーアウト
 * - 自分が既に保持中の他ペンを解放してから自分を選択 (1人1本ルール)
 *
 * 状態管理: すべて Ubi.state で宣言的に。
 * - color / strokeWidth: persistent (entity.data と双方向同期)
 * - lockedBy:            topLevel  (ComponentInstance top-level と双方向同期)
 */

interface PenData {
    color: string;
    strokeWidth: number;
}

const pen = Ubi.state.define({
    color: Ubi.state.sync('#1a1a1a'),
    strokeWidth: Ubi.state.sync(4),
    lockedBy: Ubi.state.sync<string | null>(null, { topLevel: 'lockedBy' }),
});

// ── アクション ───────────────────────────────────────────
async function selectMe(): Promise<void> {
    const myId = Ubi.myUserId;
    const selfId = Ubi.componentInstanceId;
    if (!myId || !selfId) return;
    // 他の自分が保持中のペンを解放してから自分を選択 (自 state は下で local 経由で書く)
    const allPens = await Ubi.entity.query<PenData>('pen:pen');
    await Promise.all(
        allPens
            .filter((p) => p.id !== selfId && p.lockedBy === myId)
            .map((p) =>
                Ubi.entity(p.id)
                    .update({ lockedBy: null })
                    .catch(() => {}),
            ),
    );
    pen.local.lockedBy = myId;
    Ubi.event.sendToHost('user:update', { penColor: pen.local.color });
}

function releaseMe(): void {
    pen.local.lockedBy = null;
    Ubi.event.sendToHost('user:update', { penColor: null });
}

// ── レンダリング (pure: 入力から VNode を構築) ─────────
const renderPen = (): void => {
    const myId = Ubi.myUserId;
    const heldBy = pen.local.lockedBy;
    const isHeldByMe = heldBy !== null && heldBy === myId;
    const isHeldByOther = heldBy !== null && heldBy !== myId;
    const color = pen.local.color;

    Ubi.ui.render(
        () => (
            <button
                type="button"
                title={isHeldByOther ? '使用中' : color}
                disabled={isHeldByOther}
                onUbiClick={() => {
                    if (isHeldByOther) return;
                    if (isHeldByMe) releaseMe();
                    else void selectMe();
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
pen.onChange('lockedBy', renderPen);

// 初期 1 回レンダー (初期エンティティスナップショットは Ubi.state が反映済み)
renderPen();
