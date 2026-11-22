import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME, decodePrefabDrag, PREFAB_DRAG_MIME, type PrefabDragRef } from '../lib/dnd';
import { applyDrag, type DragMode, type DragState, MIN_SIZE } from '../lib/dragHelpers';
import type { StageRect } from '../lib/drawnBounds';
import { type EntityPath, type FlatEntityNode, isDescendantOrSelf, pathKey } from '../lib/entityTree';
import { entityLabel, groupBounds, isInsidePrefab, outermostPrefabRoot, pressOnStage } from '../lib/stageSelection';
import { PrefabIcon } from './hierarchy/hierarchyIcons';

interface EditOverlayProps {
    /** 定義の Entity の木（置いたプレハブを一式で選ぶのに使う）。 */
    entities: InitialEntity[];
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
    /** 何も無いところに部品を落としたとき（その場所に新しい Entity を作る）。座標はワールド座標。 */
    onDropComponentAt: (componentType: string, point: { x: number; y: number }) => void;
    /** プレハブを落としたとき（その場所に一式を置く）。 */
    onDropPrefab: (ref: PrefabDragRef, point: { x: number; y: number }) => void;
}

/** 押してから、これより動かなければ「押して離しただけ」とみなす (px)。 */
const CLICK_SLOP = 3;

interface StageDrag extends DragState {
    /** 動かさずに離したら選ぶ Entity（プレハブの中に入る）。 */
    enterOnClick: EntityPath | null;
    moved: boolean;
}

/**
 * World 座標系の編集オーバーレイ。全 Entity (ルート + 子) に handle を重ねる。
 * 表示位置は絶対座標、保存時は親基準座標で patch する。マウス・指・ペンのどれでも動かせる（pointer events）。
 */
export function EditOverlay({
    entities,
    nodes,
    selectedPath,
    hiddenPathKeys,
    snapStep,
    worldSize,
    onSelect,
    onPatchTransform,
    onDropComponent,
    onDropComponentAt,
    onDropPrefab,
}: EditOverlayProps) {
    const [drag, setDrag] = useState<StageDrag | null>(null);
    // Component drop hover: ハイライト中の 1 entity の path-key のみ保持。
    // dragend で必ず null に戻す → 滞留しない。
    const [dropHoverKey, setDropHoverKey] = useState<string | null>(null);

    useEffect(() => {
        if (!drag) return;
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - drag.startClient.x;
            const dy = ev.clientY - drag.startClient.y;
            if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
            if (!drag.moved) setDrag({ ...drag, moved: true });
            onPatchTransform(drag.path, applyDrag(drag, dx, dy, { snapStep, worldSize }));
        };
        const onUp = () => {
            if (!drag.moved && drag.enterOnClick) onSelect(drag.enterOnClick);
            setDrag(null);
        };
        const onCancel = () => setDrag(null);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
        };
    }, [drag, onPatchTransform, onSelect, snapStep, worldSize]);

    useEffect(() => {
        const clear = () => setDropHoverKey(null);
        window.addEventListener('dragend', clear);
        return () => window.removeEventListener('dragend', clear);
    }, []);

    const visibleNodes = nodes.filter(
        (node) => !hiddenPathKeys || !node.path.some((_, i) => hiddenPathKeys.has(pathKey(node.path.slice(0, i + 1)))),
    );
    const nodeAt = (path: EntityPath) => visibleNodes.find((n) => pathKey(n.path) === pathKey(path));

    const startDrag = (ev: React.PointerEvent, path: EntityPath, mode: DragMode, enterOnClick: EntityPath | null) => {
        const target = nodeAt(path);
        if (!target) return;
        const t = target.entity.transform;
        const sizeless = (t.w ?? 0) <= 0 || (t.h ?? 0) <= 0;
        onSelect(path);
        setDrag({
            path,
            mode: sizeless ? 'move' : mode,
            startClient: { x: ev.clientX, y: ev.clientY },
            startTransform: { x: t.x, y: t.y, w: sizeless ? 0 : (t.w ?? 0), h: sizeless ? 0 : (t.h ?? 0) },
            // 隠している子も一緒に動くので、見えているものに絞らない
            extent: groupBounds(nodes, path) ?? { x: target.absX, y: target.absY, width: MIN_SIZE, height: MIN_SIZE },
            enterOnClick,
            moved: false,
        });
    };

    const pressEntity = (ev: React.PointerEvent, pressed: EntityPath, mode: DragMode) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        // 置いたプレハブは一式を選んで動かす。大きさを変えるのは選んでいる Entity そのもの
        const press = mode === 'move' ? pressOnStage(entities, pressed, selectedPath) : null;
        startDrag(ev, press?.select ?? pressed, mode, press?.enterOnClick ?? null);
    };

    // プレハブの中を選んでいないとき、中の Entity の名札は出さない（一式の名札だけ）
    const labelShown = (path: EntityPath) => {
        const root = outermostPrefabRoot(entities, path);
        return !root || root.length === path.length || isInsidePrefab(root, selectedPath);
    };

    const groups = visibleNodes.flatMap((node) => {
        const isPrefab = !!node.entity.prefab;
        const selected = !!selectedPath && pathKey(selectedPath) === pathKey(node.path);
        if (!isPrefab && !(selected && node.entity.children.length > 0)) return [];
        const bounds = groupBounds(visibleNodes, node.path);
        if (!bounds) return [];
        const active = !!selectedPath && isDescendantOrSelf(selectedPath, node.path);
        return [{ node, bounds, selected, active, isPrefab }];
    });
    const groupedKeys = new Set(groups.map((g) => pathKey(g.node.path)));

    return (
        <div
            onPointerDown={(e) => {
                if (e.target === e.currentTarget) onSelect(null);
            }}
            onDragOver={(e) => {
                if (e.defaultPrevented) return;
                const types = e.dataTransfer.types;
                if (!types.includes(PREFAB_DRAG_MIME) && !types.includes(COMPONENT_DRAG_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropHoverKey(null);
            }}
            onDrop={(e) => {
                if (e.defaultPrevented) return;
                const origin = e.currentTarget.getBoundingClientRect();
                const point = { x: Math.round(e.clientX - origin.left), y: Math.round(e.clientY - origin.top) };
                const prefab = decodePrefabDrag(e.dataTransfer.getData(PREFAB_DRAG_MIME));
                const componentType = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                if (!prefab && !componentType) return;
                e.preventDefault();
                setDropHoverKey(null);
                if (prefab) onDropPrefab(prefab, point);
                else onDropComponentAt(componentType, point);
            }}
            className={css({
                position: 'absolute',
                inset: 0,
                pointerEvents: 'auto',
                zIndex: 99000,
            })}
        >
            {visibleNodes.map((node) => {
                const t = node.entity.transform;
                const w = t.w ?? 0;
                const h = t.h ?? 0;
                const key = pathKey(node.path);
                const sizeless = w <= 0 || h <= 0;
                // 大きさの無いプレハブの親は一式の枠の名札で掴む。中に入るまで、中の大きさの無い Entity の印は出さない
                if (sizeless && (groupedKeys.has(key) || !labelShown(node.path))) return null;
                const selected = !!selectedPath && pathKey(selectedPath) === key;
                const dropProps = componentDropProps(
                    () => setDropHoverKey(key),
                    (type) => onDropComponent(node.path, type),
                );
                const common = {
                    entity: node.entity,
                    absX: node.absX,
                    absY: node.absY,
                    absZ: node.absZ,
                    selected,
                    isDropTarget: dropHoverKey === key,
                    showLabel: labelShown(node.path),
                    dropProps,
                };
                return sizeless ? (
                    <SizelessChip key={key} {...common} onPress={(ev) => pressEntity(ev, node.path, 'move')} />
                ) : (
                    <EntityHandle key={key} {...common} onPress={(ev, mode) => pressEntity(ev, node.path, mode)} />
                );
            })}
            {groups.map((g) => (
                <GroupFrame
                    key={`group:${pathKey(g.node.path)}`}
                    label={entityLabel(g.node.entity)}
                    bounds={g.bounds}
                    absZ={g.node.absZ}
                    selected={g.selected}
                    active={g.active}
                    isPrefab={g.isPrefab}
                    onPress={(ev) => {
                        if (ev.button !== 0) return;
                        ev.stopPropagation();
                        startDrag(ev, g.node.path, 'move', null);
                    }}
                />
            ))}
        </div>
    );
}

interface DropProps {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
}

function componentDropProps(onHover: () => void, onDropType: (type: string) => void): DropProps {
    const accept = (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        onHover();
    };
    return {
        onDragOver: accept,
        onDragEnter: accept,
        onDrop: (e) => {
            const type = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
            if (!type) return;
            e.preventDefault();
            onDropType(type);
        },
    };
}

interface HandleProps {
    entity: InitialEntity;
    absX: number;
    absY: number;
    absZ: number;
    selected: boolean;
    isDropTarget: boolean;
    showLabel: boolean;
    dropProps: DropProps;
}

function EntityHandle({
    entity,
    absX,
    absY,
    absZ,
    selected,
    isDropTarget,
    showLabel,
    dropProps,
    onPress,
}: HandleProps & { onPress: (ev: React.PointerEvent, mode: DragMode) => void }) {
    const t = entity.transform;
    return (
        <div
            onPointerDown={(e) => onPress(e, 'move')}
            {...dropProps}
            className={css({
                position: 'absolute',
                cursor: 'move',
                pointerEvents: 'auto',
                userSelect: 'none',
                touchAction: 'none',
                outlineOffset: '-1px',
                outline: selected || isDropTarget ? '2px solid' : '1.5px dashed',
                outlineColor: isDropTarget ? 'success' : selected ? 'primary' : 'selectionDashed',
                bg: selected ? 'primarySubtle' : 'transparent',
            })}
            style={{
                left: absX,
                top: absY,
                width: t.w ?? 0,
                height: t.h ?? 0,
                zIndex: 99000 + absZ,
            }}
        >
            {(showLabel || selected) && <EntityLabel entity={entity} selected={selected} />}
            {selected && (
                <>
                    <Handle position="nw" onPress={(e) => onPress(e, 'resize-nw')} />
                    <Handle position="ne" onPress={(e) => onPress(e, 'resize-ne')} />
                    <Handle position="sw" onPress={(e) => onPress(e, 'resize-sw')} />
                    <Handle position="se" onPress={(e) => onPress(e, 'resize-se')} />
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
    isDropTarget,
    showLabel,
    dropProps,
    onPress,
}: HandleProps & { onPress: (ev: React.PointerEvent) => void }) {
    return (
        <div
            onPointerDown={onPress}
            {...dropProps}
            className={css({
                position: 'absolute',
                width: '28px',
                height: '28px',
                cursor: 'move',
                pointerEvents: 'auto',
                touchAction: 'none',
                bg: selected ? 'chipBgActive' : 'chipBg',
                border: '2px solid',
                borderColor: isDropTarget ? 'success' : 'white',
                borderRadius: '50%',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '11px',
                fontWeight: '600',
                boxShadow: selected ? 'selectionRing' : 'chipDrop',
            })}
            style={{
                left: absX,
                top: absY,
                zIndex: 99000 + absZ,
            }}
        >
            {(showLabel || selected) && <EntityLabel entity={entity} selected={selected} />}●
        </div>
    );
}

/**
 * 置いたプレハブ（と、選んだ親）の一式の枠。枠は押せず（中の Entity が押せるように）、名札で一式を掴む。
 */
function GroupFrame({
    label,
    bounds,
    absZ,
    selected,
    active,
    isPrefab,
    onPress,
}: {
    label: string;
    bounds: StageRect;
    absZ: number;
    selected: boolean;
    active: boolean;
    isPrefab: boolean;
    onPress: (ev: React.PointerEvent) => void;
}) {
    return (
        <div
            aria-hidden="true"
            className={css({
                position: 'absolute',
                pointerEvents: 'none',
                outline: selected ? '2px solid' : '1.5px dashed',
                outlineColor: selected ? 'primary' : active ? 'primary' : 'selectionDashed',
                outlineOffset: '4px',
                borderRadius: '4px',
            })}
            style={{
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
                // 中の Entity の handle より上に名札を出す
                zIndex: 99000 + absZ + 1,
            }}
        >
            <span
                onPointerDown={onPress}
                className={css({
                    position: 'absolute',
                    bottom: 'calc(100% + 6px)',
                    left: '-4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '1',
                    fontSize: '11px',
                    fontWeight: '600',
                    padding: '2px 6px',
                    bg: selected ? 'primary' : 'chipLabelBg',
                    color: 'white',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    cursor: 'move',
                    pointerEvents: 'auto',
                    touchAction: 'none',
                    userSelect: 'none',
                })}
            >
                {isPrefab && <PrefabIcon size={12} />}
                {label}
            </span>
        </div>
    );
}

function EntityLabel({ entity, selected }: { entity: InitialEntity; selected: boolean }) {
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
            {entityLabel(entity)}
        </span>
    );
}

function Handle({
    position,
    onPress,
}: {
    position: 'nw' | 'ne' | 'sw' | 'se';
    onPress: (e: React.PointerEvent) => void;
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
            onPointerDown={(e) => {
                e.stopPropagation();
                onPress(e);
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
                touchAction: 'none',
            })}
            style={{ ...offset[position], cursor }}
        />
    );
}
