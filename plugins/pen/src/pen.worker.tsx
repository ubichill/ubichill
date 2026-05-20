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
 * 状態管理:
 * - color / strokeWidth は Ubi.state.persistent で entity.data と双方向自動同期
 * - lockedBy は data に乗らない top-level フィールドなので System で手動同期
 */

import type { ComponentInstance, Entity, System, WorkerEvent } from '@ubichill/sdk';

interface PenData {
    color: string;
    strokeWidth: number;
}

// ── 永続フィールド (entity.data 自動同期) ─────────────────
const pen = Ubi.state.define({
    color: Ubi.state.persistent('#1a1a1a'),
    strokeWidth: Ubi.state.persistent(4),
});

// ── ローカル: lockedBy 追跡用の単一可変参照 ──────────────
// (entity 上の top-level フィールドのため Ubi.state では追跡不能)
const local = { lockedBy: null as string | null };

// ── アクション ───────────────────────────────────────────
async function selectMe(): Promise<void> {
    const myId = Ubi.myUserId;
    const selfId = Ubi.componentInstanceId;
    if (!myId || !selfId) return;
    try {
        const allPens = await Ubi.world.queryEntities<PenData>('pen:pen');
        await Promise.all(
            allPens
                .filter((p) => p.id !== selfId && p.lockedBy === myId)
                .map((p) => Ubi.world.updateEntity(p.id, { lockedBy: null }).catch(() => {})),
        );
        await Ubi.world.updateEntity(selfId, { lockedBy: myId });
        Ubi.network.sendToHost('user:update', { penColor: pen.local.color });
    } catch (err) {
        Ubi.log(`[pen:pen] 選択失敗: ${String(err)}`, 'warn');
    }
}

async function releaseMe(): Promise<void> {
    const selfId = Ubi.componentInstanceId;
    if (!selfId) return;
    try {
        await Ubi.world.updateEntity(selfId, { lockedBy: null });
        Ubi.network.sendToHost('user:update', { penColor: null });
    } catch (err) {
        Ubi.log(`[pen:pen] 解放失敗: ${String(err)}`, 'warn');
    }
}

// ── レンダリング (pure: 入力から VNode を構築) ─────────
const renderPen = (): void => {
    const myId = Ubi.myUserId;
    const heldBy = local.lockedBy;
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
                    if (isHeldByMe) void releaseMe();
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

// data 側の変化は宣言的に再描画にひもづける
pen.onChange('color', renderPen);
pen.onChange('strokeWidth', renderPen);

// lockedBy 同期: 自 Component に対する entity:pen:pen を畳み込む
const PenSelfSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    const selfId = Ubi.componentInstanceId;
    if (!selfId) return;

    const nextLocked = events.reduce<string | null>((acc, event) => {
        if (event.type !== 'entity:pen:pen') return acc;
        const e = event.payload as ComponentInstance<PenData> | undefined;
        if (!e || e.id !== selfId) return acc;
        return e.lockedBy ?? null;
    }, local.lockedBy);

    if (nextLocked !== local.lockedBy) {
        local.lockedBy = nextLocked;
        renderPen();
    }
};

Ubi.registerSystem(PenSelfSystem);

// 初期 1 回レンダー (初期エンティティスナップショットは Ubi.state 側で同期反映済み)
renderPen();
