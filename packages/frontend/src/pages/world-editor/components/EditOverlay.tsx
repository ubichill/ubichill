import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { applyDrag, type DragMode, type DragState } from '../lib/dragHelpers';

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
 *
 * 編集モード中はプラグイン UI への直接操作をブロックする「シールド」を兼ねる。
 * pointer-events: auto で全クリックを overlay が吸収し、エンティティハンドル以外
 * (背景) は onSelect(null) で選択解除する。
 *
 * 色は inline style ではなく className に統一し、Panda CSS トークンで管理する。
 * 座標・サイズ・z-index など「エンティティごとに動的に変わる値」のみ style で渡す。
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
            onMouseDown={(e) => onMouseDownEntity(e, 'move')}
            className={css({
                position: 'absolute',
                cursor: 'move',
                pointerEvents: 'auto',
                userSelect: 'none',
                outlineOffset: '-1px',
                outline: selected ? '2px solid' : '1.5px dashed',
                outlineColor: selected ? 'primary' : 'selectionDashed',
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
            <KindLabel kind={entity.kind} selected={selected} />
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
            onMouseDown={onMouseDownEntity}
            className={css({
                position: 'absolute',
                width: '28px',
                height: '28px',
                cursor: 'move',
                pointerEvents: 'auto',
                bg: selected ? 'chipBgActive' : 'chipBg',
                border: '2px solid',
                borderColor: 'white',
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
            <KindLabel kind={entity.kind} selected={selected} />●
        </div>
    );
}

/** エンティティの kind を上に表示する小さなラベル。selected 時に primary 色で強調。 */
function KindLabel({ kind, selected }: { kind: string; selected: boolean }) {
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
            {kind}
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
