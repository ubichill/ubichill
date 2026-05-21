/**
 * pen:tray Worker — ペン置き場 + 太さ設定 UI。
 *
 * tray はペンの「表示」「選択」は持たない (pen:pen Worker の責務)。
 * 担当: 背景の枠を描く / 自 subtree で「自分が保持中」のペンに対し strokeWidth 設定 UI を出す。
 *
 * watchScope='subtree' により、tray-warm は warm 系ペンしか見えない。
 * → 別 tray のペンを保持中はその tray にだけ size selector が出る。
 */

import type { ComponentInstance, Entity, System, WorkerEvent } from '@ubichill/sdk';

interface PenData {
    color: string;
    strokeWidth: number;
}

interface PenEntry {
    readonly id: string;
    readonly lockedBy: string | null;
    readonly data: PenData;
}

const SIZES = [2, 4, 8, 16] as const;

// ── ローカル状態: subtree 上の pen:pen インデックス ──
// (subtree 内に複数ペンがあるため Ubi.state.sync は使えず手動管理)
const knownPens = new Map<string, PenEntry>();

const setSize = (id: string, size: number): void => {
    const p = knownPens.get(id);
    if (!p) return;
    // tray が「他 entity (pen:pen)」を直接書く escape hatch なので Ubi.world.update を使う
    Ubi.world
        .update(id, { data: { ...p.data, strokeWidth: size } })
        .catch((err) => Ubi.log(`[pen:tray] サイズ変更失敗: ${String(err)}`, 'warn'));
};

const findHeldByMe = (): PenEntry | null => {
    const myId = Ubi.myUserId;
    if (!myId) return null;
    for (const p of knownPens.values()) if (p.lockedBy === myId) return p;
    return null;
};

const renderTray = (): void => {
    const held = findHeldByMe();
    const color = held?.data.color ?? '#888';
    const currentSize = held?.data.strokeWidth ?? 4;

    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'absolute',
                    inset: '0',
                    backgroundColor: 'rgba(245,245,247,0.92)',
                    borderRadius: '12px',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    userSelect: 'none',
                    pointerEvents: 'none',
                }}
            >
                {held && (
                    <div
                        style={{
                            position: 'absolute',
                            left: '0',
                            right: '0',
                            bottom: '8px',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '0 4px',
                            pointerEvents: 'auto',
                        }}
                    >
                        {SIZES.map((s) => {
                            const isSelected = currentSize === s;
                            return (
                                <button
                                    key={String(s)}
                                    type="button"
                                    title={`${s}px`}
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '50%',
                                        border: isSelected ? `2px solid ${color}` : '2px solid rgba(0,0,0,0.15)',
                                        background: isSelected ? `${color}22` : 'transparent',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '0',
                                        transition: 'all 0.15s',
                                    }}
                                    onUbiClick={() => setSize(held.id, s)}
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
                )}
            </div>
        ),
        'pen-tray',
    );
};

/** entity:pen:pen イベントを 1 個取り込み、変化があれば true を返す副作用つき判定。 */
const ingestEvent = (event: WorkerEvent): boolean => {
    if (event.type !== 'entity:pen:pen') return false;
    const e = event.payload as ComponentInstance<PenData> | undefined;
    if (!e) return false;
    const prev = knownPens.get(e.id);
    const next: PenEntry = {
        id: e.id,
        lockedBy: e.lockedBy ?? null,
        data: { color: e.data.color, strokeWidth: e.data.strokeWidth },
    };
    if (
        prev &&
        prev.lockedBy === next.lockedBy &&
        prev.data.color === next.data.color &&
        prev.data.strokeWidth === next.data.strokeWidth
    ) {
        return false;
    }
    knownPens.set(e.id, next);
    return true;
};

const PenTraySystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    const changed = events.reduce((acc, ev) => ingestEvent(ev) || acc, false);
    if (changed) renderTray();
};

Ubi.registerSystem(PenTraySystem);

// 初期 1 回レンダー (枠だけ — 保持ペン未確定なので size selector はまだ出ない)
renderTray();
