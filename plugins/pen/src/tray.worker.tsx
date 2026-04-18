/**
 * pen:tray Worker — ペン選択トレイ UI
 *
 * - watchEntityTypes: ['pen:pen'] により pen:pen エンティティの変更通知を受け取る
 * - Ubi.world.queryEntities('pen:pen') で初期ペン一覧を取得
 * - ペン選択は lockedBy を使用（isHeld 廃止）
 *   - 自分が選択: lockedBy = Ubi.myUserId
 *   - 解放: lockedBy = null
 *   - 他ユーザーが保持中: lockedBy = 他のユーザーID → グレーアウト表示
 */

import type { Entity, System, WorkerEvent, WorldEntity } from '@ubichill/sdk';

// ────────────────────────────────────────────────────────────────
// 状態
// ────────────────────────────────────────────────────────────────

interface PenData {
    color: string;
    strokeWidth: number;
}

interface PenEntry {
    id: string;
    data: PenData;
    lockedBy: string | null;
    z: number;
}

/** entityId → PenEntry */
const penEntities = new Map<string, PenEntry>();
let trayZIndex = 0;
let trayDirty = false;

const SIZES = [2, 4, 8, 16] as const;

// ────────────────────────────────────────────────────────────────
// 初期化 (async — IIFE)
// ────────────────────────────────────────────────────────────────

void (async () => {
    const entityId = Ubi.entityId;
    if (entityId) {
        try {
            const trayEntity = await Ubi.world.getEntity(entityId);
            if (trayEntity) {
                trayZIndex = trayEntity.transform.z ?? trayZIndex;
            }
        } catch {
            // 失敗時はデフォルト値を使用
        }
    }

    try {
        const pens = await Ubi.world.queryEntities('pen:pen');
        for (const pen of pens) {
            penEntities.set(pen.id, {
                id: pen.id,
                data: pen.data as PenData,
                lockedBy: pen.lockedBy ?? null,
                z: pen.transform.z ?? 0,
            });
        }
        trayDirty = true;
        Ubi.log(`[PenTray] 初期化完了: ${penEntities.size} ペン, zIndex=${trayZIndex}`, 'info');
    } catch (err) {
        Ubi.log(`[PenTray] ペン一覧取得失敗: ${String(err)}`, 'warn');
    }
})();

// ────────────────────────────────────────────────────────────────
// ヘルパー
// ────────────────────────────────────────────────────────────────

/** 指定ペンを自分のものとしてロックし、自分が保持していた他のペンを解放する */
async function selectPen(penId: string): Promise<void> {
    const myId = Ubi.myUserId;
    if (!myId) return;

    // 自分が保持中の他のペンを解放
    for (const pen of penEntities.values()) {
        if (pen.id === penId) continue;
        if (pen.lockedBy === myId) {
            await Ubi.world.updateEntity(pen.id, { lockedBy: null });
        }
    }
    await Ubi.world.updateEntity(penId, { lockedBy: myId });

    // 自分のペン色を他ユーザーに共有（avatar:cursor の RemoteCursor で表示）
    const pen = penEntities.get(penId);
    if (pen) {
        Ubi.network.sendToHost('user:update', { penColor: pen.data.color });
    }
}

/** 保持中のペンを返却する */
async function releasePen(penId: string): Promise<void> {
    const pen = penEntities.get(penId);
    if (pen?.lockedBy === Ubi.myUserId) {
        await Ubi.world.updateEntity(penId, { lockedBy: null });
        Ubi.network.sendToHost('user:update', { penColor: null });
    }
}

/** 保持中ペンのサイズを変更する（自分がロックしている場合のみ） */
async function setSize(penId: string, size: number): Promise<void> {
    const pen = penEntities.get(penId);
    if (!pen || pen.lockedBy !== Ubi.myUserId) return;
    await Ubi.world.updateEntity(penId, { data: { ...pen.data, strokeWidth: size } });
}

// ────────────────────────────────────────────────────────────────
// レンダリング
// ────────────────────────────────────────────────────────────────

function renderTray(): void {
    const myId = Ubi.myUserId;
    const pens = Array.from(penEntities.values()).sort((a, b) => a.z - b.z);
    const heldPen = pens.find((p) => p.lockedBy === myId) ?? null;

    Ubi.ui.render(
        () => (
            <div
                style={{
                    width: 'max-content',
                    backgroundColor: 'rgba(255,255,255,0.55)',
                    borderRadius: '12px',
                    boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.12)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.7)',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    zIndex: trayZIndex,
                    pointerEvents: 'auto',
                    userSelect: 'none',
                }}
            >
                {pens.map((pen) => {
                    const isSelectedByMe = pen.lockedBy === myId;
                    const isLockedByOther = pen.lockedBy !== null && pen.lockedBy !== myId;
                    return (
                        <button
                            key={pen.id}
                            type="button"
                            title={isLockedByOther ? `使用中` : pen.data.color}
                            style={{
                                width: '36px',
                                height: '48px',
                                borderRadius: '8px',
                                border: isSelectedByMe ? `2px solid ${pen.data.color}` : '2px solid transparent',
                                background: isSelectedByMe ? `${pen.data.color}22` : 'rgba(0,0,0,0.04)',
                                cursor: isLockedByOther ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                padding: '4px',
                                transition: 'all 0.15s',
                                opacity: isLockedByOther ? 0.35 : 1,
                            }}
                            onUbiClick={() => {
                                if (isLockedByOther) return;
                                if (isSelectedByMe) {
                                    void releasePen(pen.id);
                                } else {
                                    void selectPen(pen.id);
                                }
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
                                    fill={pen.data.color}
                                    stroke="rgba(0,0,0,0.2)"
                                    strokeWidth="0.8"
                                />
                                <rect x="6" y="6" width="2.5" height="14" rx="1" fill="rgba(255,255,255,0.3)" />
                                <rect x="5" y="1" width="8" height="5" rx="1.5" fill="rgba(0,0,0,0.2)" />
                            </svg>
                        </button>
                    );
                })}

                {pens.length > 0 && (
                    <div
                        style={{
                            width: '1px',
                            height: '36px',
                            backgroundColor: 'rgba(0,0,0,0.15)',
                            margin: '0 4px',
                            flexShrink: '0',
                        }}
                    />
                )}

                {heldPen &&
                    SIZES.map((s) => {
                        const isSelected = heldPen.data.strokeWidth === s;
                        return (
                            <button
                                key={String(s)}
                                type="button"
                                title={`${s}px`}
                                style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    border: isSelected
                                        ? `2px solid ${heldPen.data.color}`
                                        : '2px solid rgba(0,0,0,0.15)',
                                    background: isSelected ? `${heldPen.data.color}22` : 'transparent',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '0',
                                    transition: 'all 0.15s',
                                }}
                                onUbiClick={() => {
                                    void setSize(heldPen.id, s);
                                }}
                            >
                                <div
                                    style={{
                                        width: Math.min(s * 1.5, 22),
                                        height: Math.min(s * 1.5, 22),
                                        borderRadius: '50%',
                                        background: isSelected ? heldPen.data.color : 'rgba(0,0,0,0.4)',
                                    }}
                                />
                            </button>
                        );
                    })}
            </div>
        ),
        'pen-tray',
    );
}

// ────────────────────────────────────────────────────────────────
// ECS System
// ────────────────────────────────────────────────────────────────

const PenTraySystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type === 'entity:pen:pen') {
            const worldEntity = event.payload as WorldEntity;
            penEntities.set(worldEntity.id, {
                id: worldEntity.id,
                data: worldEntity.data as PenData,
                lockedBy: worldEntity.lockedBy ?? null,
                z: worldEntity.transform.z ?? 0,
            });
            trayDirty = true;
        }
    }

    if (!trayDirty) return;
    trayDirty = false;
    renderTray();
};

Ubi.registerSystem(PenTraySystem);

console.log('[PenTray Worker] Initialized.');
