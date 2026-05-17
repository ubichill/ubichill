import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';
import { applyDrag, type DragMode, type DragState } from '../lib/dragHelpers';
import type { EntityPath, FlatEntityNode } from '../lib/entityTree';

interface EditOverlayProps {
    /** flatten 済みの全 Entity（path + 絶対座標）。 */
    nodes: FlatEntityNode[];
    selectedPath: EntityPath | null;
    /** path key の Set。祖先が hidden ならその子孫も描画しない。 */
    hiddenPathKeys?: Set<string>;
    /** スナップ ON のときの grid step (px)。 */
    snapStep?: number;
    /** ワールド範囲。指定があれば座標 / サイズを範囲内に clamp する。 */
    worldSize?: { width: number; height: number };
    onSelect: (path: EntityPath | null) => void;
    /** 親基準の transform 差分を patch する。 */
    onPatchTransform: (path: EntityPath, patch: Partial<InitialEntity['transform']>) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
}

/**
 * World 座標系の編集オーバーレイ。全 Entity (ルート + 子) に handle を重ねる。
 * 表示位置は絶対座標、保存時は親基準座標で patch する。
 */
export function EditOverlay({
    nodes,
    selectedPath,
    hiddenPathKeys,
    snapStep,
    worldSize,
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
            onPatchTransform(drag.path, applyDrag(drag, dx, dy, { snapStep, worldSize }));
        };
        const onUp = () => setDrag(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [drag, onPatchTransform, snapStep, worldSize]);

    // 祖先が hidden ならスキップ
    const isHiddenByAncestor = (path: EntityPath): boolean => {
        if (!hiddenPathKeys) return false;
        for (let i = 1; i <= path.length; i += 1) {
            if (hiddenPathKeys.has(path.slice(0, i).join('-'))) return true;
        }
        return false;
    };

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
            {nodes.map((node) => {
                if (isHiddenByAncestor(node.path)) return null;
                const t = node.entity.transform;
                const w = t.w ?? 0;
                const h = t.h ?? 0;
                const sizeless = w <= 0 || h <= 0;
                const selected = !!selectedPath && pathsEqual(selectedPath, node.path);
                const handleMouseDown = (ev: React.MouseEvent, mode: DragMode) => {
                    ev.stopPropagation();
                    onSelect(node.path);
                    setDrag({
                        path: node.path,
                        mode,
                        startClient: { x: ev.clientX, y: ev.clientY },
                        // ドラッグの x/y 起点は「保存される値」(= 親基準) のままで OK。
                        startTransform: { x: t.x, y: t.y, w: sizeless ? 0 : w, h: sizeless ? 0 : h },
                    });
                };
                const onDropType = (type: string) => onDropComponent(node.path, type);
                if (sizeless) {
                    return (
                        <SizelessChip
                            key={node.path.join('-')}
                            entity={node.entity}
                            absX={node.absX}
                            absY={node.absY}
                            absZ={node.absZ}
                            selected={selected}
                            onMouseDownEntity={(ev) => handleMouseDown(ev, 'move')}
                            onDropType={onDropType}
                        />
                    );
                }
                return (
                    <EntityHandle
                        key={node.path.join('-')}
                        entity={node.entity}
                        absX={node.absX}
                        absY={node.absY}
                        absZ={node.absZ}
                        selected={selected}
                        onMouseDownEntity={handleMouseDown}
                        onDropType={onDropType}
                    />
                );
            })}
        </div>
    );
}

function pathsEqual(a: EntityPath, b: EntityPath): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}

function EntityHandle({
    entity,
    absX,
    absY,
    absZ,
    selected,
    onMouseDownEntity,
    onDropType,
}: {
    entity: InitialEntity;
    absX: number;
    absY: number;
    absZ: number;
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
                left: absX,
                top: absY,
                width: w,
                height: h,
                zIndex: 99000 + absZ,
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

function SizelessChip({
    entity,
    absX,
    absY,
    absZ,
    selected,
    onMouseDownEntity,
    onDropType,
}: {
    entity: InitialEntity;
    absX: number;
    absY: number;
    absZ: number;
    selected: boolean;
    onMouseDownEntity: (ev: React.MouseEvent) => void;
    onDropType: (type: string) => void;
}) {
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
                left: absX,
                top: absY,
                zIndex: 99000 + absZ,
            }}
        >
            <EntityLabel entity={entity} selected={selected} />●
        </div>
    );
}

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
