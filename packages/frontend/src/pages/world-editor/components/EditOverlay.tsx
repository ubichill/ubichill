import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';
import { applyDrag, type DragMode, type DragState } from '../lib/dragHelpers';

interface EditOverlayProps {
    entities: InitialEntity[];
    selectedIndex: number | null;
    hiddenIndices?: Set<number>;
    onSelect: (index: number | null) => void;
    onPatchTransform: (index: number, patch: Partial<InitialEntity['transform']>) => void;
    /** Component カードをステージ上の Entity に drop したときの追加。 */
    onDropComponent: (entityIndex: number, componentType: string) => void;
}

/**
 * world 座標系の編集オーバーレイ。各 Entity に矩形ハンドルを重ねて移動・リサイズし、
 * 編集モード中はプラグイン UI への直接操作をシールドする。
 */
export function EditOverlay({
    entities,
    selectedIndex,
    hiddenIndices,
    onSelect,
    onPatchTransform,
    onDropComponent,
}: EditOverlayProps) {
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
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onSelect(null);
            }}
            className={css({
                position: 'absolute',
                inset: 0,
                pointerEvents: 'auto',
                zIndex: 99000,
            })}
        >
            {entities.map((ent, i) => {
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
                        startTransform: { x: t.x, y: t.y, w: sizeless ? 0 : w, h: sizeless ? 0 : h },
                    });
                };
                const onDrop = (type: string) => onDropComponent(i, type);
                if (sizeless) {
                    return (
                        <SizelessChip
                            key={ent.id}
                            entity={ent}
                            selected={selected}
                            onMouseDownEntity={(ev) => handleMouseDown(ev, 'move')}
                            onDropType={onDrop}
                        />
                    );
                }
                return (
                    <EntityHandle
                        key={ent.id}
                        entity={ent}
                        selected={selected}
                        onMouseDownEntity={handleMouseDown}
                        onDropType={onDrop}
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
    onDropType,
}: {
    entity: InitialEntity;
    selected: boolean;
    onMouseDownEntity: (ev: React.MouseEvent, mode: DragMode) => void;
    onDropType: (type: string) => void;
}) {
    const t = entity.transform;
    const w = t.w ?? 0;
    const h = t.h ?? 0;
    const [dragOver, setDragOver] = useState(false);
    return (
        <div
            onMouseDown={(e) => onMouseDownEntity(e, 'move')}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDragOver(true);
                }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                const type = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                setDragOver(false);
                if (!type) return;
                e.preventDefault();
                onDropType(type);
            }}
            className={css({
                position: 'absolute',
                cursor: 'move',
                pointerEvents: 'auto',
                userSelect: 'none',
                outlineOffset: '-1px',
                outline: selected || dragOver ? '2px solid' : '1.5px dashed',
                outlineColor: dragOver ? 'success' : selected ? 'primary' : 'selectionDashed',
                bg: selected ? 'primarySubtle' : 'transparent',
            })}
            style={{
                left: t.x,
                top: t.y,
                width: w,
                height: h,
                zIndex: 99000 + (t.z ?? 0),
            }}
        >
            <EntityLabel entity={entity} selected={selected} />
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

/** サイズなし Entity 用の 28x28 チップ表示。位置編集 (ドラッグ移動) のみ可能。 */
function SizelessChip({
    entity,
    selected,
    onMouseDownEntity,
    onDropType,
}: {
    entity: InitialEntity;
    selected: boolean;
    onMouseDownEntity: (ev: React.MouseEvent) => void;
    onDropType: (type: string) => void;
}) {
    const t = entity.transform;
    const [dragOver, setDragOver] = useState(false);
    return (
        <div
            onMouseDown={onMouseDownEntity}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDragOver(true);
                }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                const type = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                setDragOver(false);
                if (!type) return;
                e.preventDefault();
                onDropType(type);
            }}
            className={css({
                position: 'absolute',
                width: '28px',
                height: '28px',
                cursor: 'move',
                pointerEvents: 'auto',
                bg: selected ? 'chipBgActive' : 'chipBg',
                border: '2px solid',
                borderColor: dragOver ? 'success' : 'white',
                borderRadius: '50%',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '11px',
                fontWeight: '700',
                boxShadow: selected ? 'selectionRing' : 'chipDrop',
            })}
            style={{
                left: t.x,
                top: t.y,
                zIndex: 99000 + (t.z ?? 0),
            }}
        >
            <EntityLabel entity={entity} selected={selected} />●
        </div>
    );
}

/**
 * エンティティ id と components 一覧を上に表示する小さなラベル。
 * `id` (GameObject) と `components.length` をコンパクトに見せる。selected 時に primary 色で強調。
 */
function EntityLabel({ entity, selected }: { entity: InitialEntity; selected: boolean }) {
    const summary = entity.components.length === 1 ? entity.components[0].type : `${entity.components.length} comps`;
    return (
        <span
            className={css({
                position: 'absolute',
                top: '-22px',
                left: 0,
                fontSize: '11px',
                padding: '2px 6px',
                bg: selected ? 'primary' : 'chipLabelBg',
                color: 'white',
                borderRadius: '4px',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
            })}
        >
            {entity.id} · {summary}
        </span>
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
    const offset: Record<string, React.CSSProperties> = {
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
            className={css({
                position: 'absolute',
                width: '14px',
                height: '14px',
                bg: 'primary',
                border: '2px solid',
                borderColor: 'white',
                borderRadius: '50%',
                zIndex: 100,
                pointerEvents: 'auto',
            })}
            style={{ ...offset[position], cursor }}
        />
    );
}
