import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { applyDrag, type DragMode, type DragState } from './dragHelpers';

interface EditOverlayProps {
    entities: InitialEntity[];
    selectedIndex: number | null;
    hiddenIndices?: Set<number>;
    onSelect: (index: number | null) => void;
    onPatchTransform: (index: number, patch: Partial<InitialEntity['transform']>) => void;
}

/**
 * world 座標系に絶対配置される編集オーバーレイ。
 * 各エンティティに矩形ハンドルを重ね、ドラッグで移動・リサイズできる。
 * サイズなしエンティティは表示しない（下のリストから選択する）。
 */
export function EditOverlay({ entities, selectedIndex, hiddenIndices, onSelect, onPatchTransform }: EditOverlayProps) {
    const [drag, setDrag] = useState<DragState | null>(null);

    useEffect(() => {
        if (!drag) return;
        const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - drag.startClient.x;
            const dy = ev.clientY - drag.startClient.y;
            onPatchTransform(drag.index, applyDrag(drag, dx, dy));
        };
        const onUp = () => setDrag(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [drag, onPatchTransform]);

    return (
        <div
            // 背景クリックで選択解除（pointer-events を持つ透明レイヤー）
            onMouseDown={() => onSelect(null)}
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none', // デフォルトは透過。子の実体だけが pointer-events: auto
                zIndex: 99000,
            }}
        >
            {entities.map((ent, i) => {
                // 非表示エンティティは overlay からも除外（クリック・選択不可）
                if (hiddenIndices?.has(i)) return null;
                const t = ent.transform;
                const w = t.w ?? 0;
                const h = t.h ?? 0;
                const sizeless = w <= 0 || h <= 0;
                const selected = i === selectedIndex;
                const handleMouseDown = (ev: React.MouseEvent, mode: DragMode) => {
                    ev.stopPropagation();
                    onSelect(i);
                    setDrag({
                        index: i,
                        mode,
                        startClient: { x: ev.clientX, y: ev.clientY },
                        // サイズなしの場合は drag 計算用に最小サイズを与える（実 transform の w/h は変えない）
                        startTransform: { x: t.x, y: t.y, w: sizeless ? 0 : w, h: sizeless ? 0 : h },
                    });
                };
                if (sizeless) {
                    return (
                        <SizelessChip
                            key={`${ent.kind}-${i}`}
                            entity={ent}
                            selected={selected}
                            onMouseDownEntity={(ev) => handleMouseDown(ev, 'move')}
                        />
                    );
                }
                return (
                    <EntityHandle
                        key={`${ent.kind}-${i}`}
                        entity={ent}
                        selected={selected}
                        onMouseDownEntity={handleMouseDown}
                    />
                );
            })}
        </div>
    );
}

function EntityHandle({
    entity,
    selected,
    onMouseDownEntity,
}: {
    entity: InitialEntity;
    selected: boolean;
    onMouseDownEntity: (ev: React.MouseEvent, mode: DragMode) => void;
}) {
    const t = entity.transform;
    const w = t.w ?? 0;
    const h = t.h ?? 0;
    return (
        <div
            role="button"
            tabIndex={0}
            onMouseDown={(e) => onMouseDownEntity(e, 'move')}
            style={{
                position: 'absolute',
                left: t.x,
                top: t.y,
                width: w,
                height: h,
                zIndex: 99000 + (t.z ?? 0),
                cursor: 'move',
                pointerEvents: 'auto',
                outline: selected ? '2px solid #1b2a44' : '1.5px dashed rgba(27, 42, 68, 0.5)',
                outlineOffset: -1,
                background: selected ? 'rgba(27, 42, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                userSelect: 'none',
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: -22,
                    left: 0,
                    fontSize: 11,
                    padding: '2px 6px',
                    background: selected ? '#1b2a44' : 'rgba(27, 42, 68, 0.7)',
                    color: '#fff',
                    borderRadius: 4,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                }}
            >
                {entity.kind}
            </span>
            {selected && (
                <>
                    <Handle position="nw" onMouseDown={(e) => onMouseDownEntity(e, 'resize-nw')} />
                    <Handle position="ne" onMouseDown={(e) => onMouseDownEntity(e, 'resize-ne')} />
                    <Handle position="sw" onMouseDown={(e) => onMouseDownEntity(e, 'resize-sw')} />
                    <Handle position="se" onMouseDown={(e) => onMouseDownEntity(e, 'resize-se')} />
                </>
            )}
        </div>
    );
}

/**
 * サイズなしエンティティ（pen:canvas, pen:pen, avatar:cursor 等）用の
 * 28x28 チップ表示。位置編集（ドラッグ移動）のみ可能。
 */
function SizelessChip({
    entity,
    selected,
    onMouseDownEntity,
}: {
    entity: InitialEntity;
    selected: boolean;
    onMouseDownEntity: (ev: React.MouseEvent) => void;
}) {
    const t = entity.transform;
    return (
        <div
            role="button"
            tabIndex={0}
            onMouseDown={onMouseDownEntity}
            style={{
                position: 'absolute',
                left: t.x,
                top: t.y,
                width: 28,
                height: 28,
                zIndex: 99000 + (t.z ?? 0),
                cursor: 'move',
                pointerEvents: 'auto',
                background: selected ? 'rgba(27, 42, 68, 0.8)' : 'rgba(27, 42, 68, 0.5)',
                border: '2px solid #fff',
                borderRadius: '50%',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                boxShadow: selected ? '0 0 0 2px #1b2a44' : '0 1px 4px rgba(0,0,0,0.3)',
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: -22,
                    left: 0,
                    fontSize: 11,
                    padding: '2px 6px',
                    background: selected ? '#1b2a44' : 'rgba(27, 42, 68, 0.7)',
                    color: '#fff',
                    borderRadius: 4,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                }}
            >
                {entity.kind}
            </span>
            ●
        </div>
    );
}

function Handle({
    position,
    onMouseDown,
}: {
    position: 'nw' | 'ne' | 'sw' | 'se';
    onMouseDown: (e: React.MouseEvent) => void;
}) {
    const cursor = position === 'nw' || position === 'se' ? 'nwse-resize' : 'nesw-resize';
    const styles: Record<string, React.CSSProperties> = {
        nw: { left: -7, top: -7 },
        ne: { right: -7, top: -7 },
        sw: { left: -7, bottom: -7 },
        se: { right: -7, bottom: -7 },
    };
    return (
        <div
            onMouseDown={(e) => {
                e.stopPropagation();
                onMouseDown(e);
            }}
            style={{
                position: 'absolute',
                width: 14,
                height: 14,
                background: '#1b2a44',
                border: '2px solid #fff',
                borderRadius: '50%',
                zIndex: 100,
                pointerEvents: 'auto',
                ...styles[position],
                cursor,
            }}
        />
    );
}
