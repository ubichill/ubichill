import type { InitialEntity } from '@ubichill/shared';
import { useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME, ENTITY_DRAG_MIME } from '../../lib/dnd';
import { type EntityPath, pathKey } from '../../lib/entityTree';
import { Chevron, EyeIcon, EyeOffIcon, PlusIcon } from './hierarchyIcons';

const INDENT_PX = 16;

function pathsEqual(a: EntityPath | null, b: EntityPath | null): boolean {
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}

const iconBtn = (active: boolean) =>
    css({
        flexShrink: 0,
        width: '20px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bg: 'transparent',
        border: 'none',
        color: active ? 'textOnPrimary' : 'textSubtle',
        cursor: 'pointer',
        borderRadius: '4px',
        fontSize: '14px',
        _hover: { bg: 'surfaceHover' },
    });

export interface EntityNodeProps {
    entity: InitialEntity;
    path: EntityPath;
    depth: number;
    ancestorHidden: boolean;
    hiddenPaths: Set<string>;
    selectedPath: EntityPath | null;
    selectedComponentIndex: number | null;
    dragOverKey: string | null;
    setDragOverKey: (key: string | null) => void;
    onSelectEntity: (path: EntityPath | null) => void;
    onSelectComponent: (componentIndex: number | null) => void;
    onCreateEmptyEntity: (parentPath: EntityPath | null) => void;
    onDeleteEntity: (path: EntityPath) => void;
    onDeleteComponent: (path: EntityPath, componentIndex: number) => void;
    onToggleHidden: (path: EntityPath) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
    onMoveEntity: (from: EntityPath, to: EntityPath | null) => void;
    onEnterChild: (path: EntityPath) => void;
    /** 右クリックで開く context menu。 `null` を渡すと無効化。 */
    onContextMenu: ((path: EntityPath, x: number, y: number) => void) | null;
}

export function EntityNode({
    entity,
    path,
    depth,
    ancestorHidden,
    hiddenPaths,
    selectedPath,
    selectedComponentIndex,
    dragOverKey,
    setDragOverKey,
    onSelectEntity,
    onSelectComponent,
    onCreateEmptyEntity,
    onDeleteEntity,
    onDeleteComponent,
    onToggleHidden,
    onDropComponent,
    onMoveEntity,
    onEnterChild,
    onContextMenu,
}: EntityNodeProps) {
    // 初期は全エンティティ畳まれた状態にする (ユーザー操作で展開)。
    const [open, setOpen] = useState(false);

    const myKey = pathKey(path);
    const isDropTarget = dragOverKey === myKey;
    const hasFocus = pathsEqual(selectedPath, path);
    const selectedEntityOnly = hasFocus && selectedComponentIndex === null;
    const selfHidden = hiddenPaths.has(myKey);
    const effectivelyHidden = selfHidden || ancestorHidden;

    const w = entity.transform.w ?? 0;
    const h = entity.transform.h ?? 0;
    const sizeBadge = w > 0 && h > 0 ? `${w}×${h}` : '—';
    const hasChildren = (entity.children?.length ?? 0) > 0;

    // ドラッグ中にこの行を「自分が target」と表明する。
    const acceptDrag = (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (!types.includes(ENTITY_DRAG_MIME) && !types.includes(COMPONENT_DRAG_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = types.includes(COMPONENT_DRAG_MIME) ? 'copy' : 'move';
        if (dragOverKey !== myKey) setDragOverKey(myKey);
    };

    const handleDrop = (e: React.DragEvent) => {
        const ctype = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
        const fromKey = e.dataTransfer.getData(ENTITY_DRAG_MIME);
        setDragOverKey(null);
        e.preventDefault();
        e.stopPropagation();
        if (ctype) {
            onDropComponent(path, ctype);
        } else if (fromKey) {
            onMoveEntity(fromKey.split('-').map(Number), path);
        }
    };

    const handleRowClick = () => {
        if (selectedEntityOnly && hasChildren && open) {
            onEnterChild(path);
            return;
        }
        onSelectEntity(path);
        onSelectComponent(null);
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column' })}>
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    bg: selectedEntityOnly ? 'primary' : 'transparent',
                    color: selectedEntityOnly ? 'textOnPrimary' : 'text',
                    opacity: effectivelyHidden ? 0.45 : 1,
                    // ドロップ可なら outline だけで示す。bg/opacity は変えない (滞留時の暗さ回避)。
                    outline: isDropTarget ? '2px solid' : 'none',
                    outlineColor: 'primary',
                    outlineOffset: '-2px',
                    _hover: { bg: selectedEntityOnly ? 'primary' : 'surfaceHover' },
                })}
                style={{ paddingLeft: 8 + depth * INDENT_PX }}
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData(ENTITY_DRAG_MIME, myKey);
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={acceptDrag}
                onDragEnter={acceptDrag}
                onDrop={handleDrop}
                onClick={handleRowClick}
                onDoubleClick={() => {
                    if (hasChildren) onEnterChild(path);
                }}
                onContextMenu={(e) => {
                    if (!onContextMenu) return;
                    e.preventDefault();
                    e.stopPropagation();
                    // 右クリックされた行を先に選択しておく (メニュー対象が分かるように)
                    onSelectEntity(path);
                    onSelectComponent(null);
                    onContextMenu(path, e.clientX, e.clientY);
                }}
            >
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        if (hasChildren) setOpen((p) => !p);
                    }}
                    className={css({
                        width: '16px',
                        height: '16px',
                        bg: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    })}
                >
                    {hasChildren ? <Chevron open={open} /> : <span />}
                </button>
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        onToggleHidden(path);
                    }}
                    aria-label={selfHidden ? '表示' : '非表示'}
                    title={selfHidden ? '表示する' : '非表示にする'}
                    className={css({
                        flexShrink: 0,
                        width: '22px',
                        height: '22px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bg: 'transparent',
                        border: 'none',
                        color: selectedEntityOnly ? 'textOnPrimary' : 'textMuted',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        _hover: { bg: 'surfaceHover' },
                    })}
                >
                    {selfHidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <div className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column', gap: '1px' })}>
                    <span
                        className={css({
                            fontSize: '12px',
                            fontWeight: '600',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textDecoration: selfHidden ? 'line-through' : 'none',
                        })}
                    >
                        {entity.id}
                    </span>
                    <span className={css({ fontSize: '10px', opacity: 0.7 })}>
                        ({Math.round(entity.transform.x)}, {Math.round(entity.transform.y)}) · {sizeBadge} ·{' '}
                        {entity.components.length}c
                    </span>
                </div>
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        onCreateEmptyEntity(path);
                    }}
                    aria-label="子 Entity を追加"
                    title="子 Entity を追加"
                    className={iconBtn(selectedEntityOnly)}
                >
                    <PlusIcon />
                </button>
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        onDeleteEntity(path);
                    }}
                    aria-label="削除"
                    title="エンティティを削除"
                    className={iconBtn(selectedEntityOnly)}
                >
                    ×
                </button>
            </div>
            {open && hasChildren && (
                <div
                    className={css({
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                    })}
                >
                    <div
                        className={css({
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            width: '1px',
                            bg: 'border',
                            pointerEvents: 'none',
                        })}
                        style={{ left: 8 + depth * INDENT_PX + 7 }}
                        aria-hidden
                    />
                    {entity.children?.map((child, ci) => (
                        <EntityNode
                            key={child.id}
                            entity={child}
                            path={[...path, ci]}
                            depth={depth + 1}
                            ancestorHidden={effectivelyHidden}
                            hiddenPaths={hiddenPaths}
                            selectedPath={selectedPath}
                            selectedComponentIndex={selectedComponentIndex}
                            dragOverKey={dragOverKey}
                            setDragOverKey={setDragOverKey}
                            onSelectEntity={onSelectEntity}
                            onSelectComponent={onSelectComponent}
                            onCreateEmptyEntity={onCreateEmptyEntity}
                            onDeleteEntity={onDeleteEntity}
                            onDeleteComponent={onDeleteComponent}
                            onToggleHidden={onToggleHidden}
                            onDropComponent={onDropComponent}
                            onMoveEntity={onMoveEntity}
                            onEnterChild={onEnterChild}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
