import type { InitialEntity } from '@ubichill/shared';
import { useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';
import { type EntityPath, pathKey } from '../lib/entityTree';

const ENTITY_DRAG_MIME = 'application/x-ubichill-entity-path';
const INDENT_PX = 16;

interface EditorHierarchyProps {
    entities: InitialEntity[];
    selectedPath: EntityPath | null;
    selectedComponentIndex: number | null;
    hiddenPaths: Set<string>;
    onSelectEntity: (path: EntityPath | null) => void;
    onSelectComponent: (componentIndex: number | null) => void;
    onCreateEmptyEntity: (parentPath: EntityPath | null) => void;
    onDeleteEntity: (path: EntityPath) => void;
    onDeleteComponent: (path: EntityPath, componentIndex: number) => void;
    onToggleHidden: (path: EntityPath) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
    /** Entity を別 Entity の子へ移動 (to=null なら root 末尾) */
    onMoveEntity: (from: EntityPath, to: EntityPath | null) => void;
    /** ダブルクリックで最初の子に降りる */
    onEnterChild: (path: EntityPath) => void;
}

export function EditorHierarchy({
    entities,
    selectedPath,
    selectedComponentIndex,
    hiddenPaths,
    onSelectEntity,
    onSelectComponent,
    onCreateEmptyEntity,
    onDeleteEntity,
    onDeleteComponent,
    onToggleHidden,
    onDropComponent,
    onMoveEntity,
    onEnterChild,
}: EditorHierarchyProps) {
    // root 余白への drop でルートに移動
    const [rootDragOver, setRootDragOver] = useState(false);
    const acceptEntityDrag = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(ENTITY_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setRootDragOver(true);
        }
    };

    return (
        <aside
            className={css({
                bg: 'surface',
                borderRight: '1px solid',
                borderColor: 'border',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minH: 0,
                width: 'full',
                height: 'full',
            })}
        >
            <div
                className={css({
                    padding: '8px 12px',
                    borderBottom: '1px solid',
                    borderColor: 'border',
                    flexShrink: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                })}
            >
                <span
                    className={css({
                        fontSize: '11px',
                        fontWeight: '700',
                        color: 'textMuted',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                    })}
                >
                    ヒエラルキー{' '}
                    <span className={css({ color: 'textSubtle', fontWeight: '500' })}>({entities.length})</span>
                </span>
                <button
                    type="button"
                    onClick={() => onCreateEmptyEntity(null)}
                    title="空の Entity を追加"
                    className={css({
                        padding: '4px 10px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        _hover: { opacity: 0.9 },
                    })}
                >
                    <PlusIcon /> Entity
                </button>
            </div>
            <div
                className={css({
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '4px',
                    minH: 0,
                    bg: rootDragOver ? 'primarySubtle' : 'transparent',
                    transition: 'background 0.1s',
                    '&::-webkit-scrollbar': { width: '6px' },
                    '&::-webkit-scrollbar-thumb': { backgroundColor: 'primarySubtle', borderRadius: '3px' },
                })}
                onClick={(e) => {
                    // 余白クリックで選択解除
                    if (e.target === e.currentTarget) onSelectEntity(null);
                }}
                onDragOver={acceptEntityDrag}
                onDragLeave={() => setRootDragOver(false)}
                onDrop={(e) => {
                    const fromKey = e.dataTransfer.getData(ENTITY_DRAG_MIME);
                    setRootDragOver(false);
                    if (!fromKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const from = fromKey.split('-').map(Number);
                    onMoveEntity(from, null);
                }}
            >
                {entities.length === 0 ? (
                    <div
                        className={css({
                            padding: '12px',
                            fontSize: '12px',
                            color: 'textSubtle',
                            textAlign: 'center',
                        })}
                    >
                        まだエンティティがありません。「+ Entity」を押すか、アセットから drop してください。
                    </div>
                ) : (
                    entities.map((entity, i) => (
                        <EntityNode
                            key={entity.id}
                            entity={entity}
                            path={[i]}
                            depth={0}
                            ancestorHidden={false}
                            hiddenPaths={hiddenPaths}
                            selectedPath={selectedPath}
                            selectedComponentIndex={selectedComponentIndex}
                            onSelectEntity={onSelectEntity}
                            onSelectComponent={onSelectComponent}
                            onCreateEmptyEntity={onCreateEmptyEntity}
                            onDeleteEntity={onDeleteEntity}
                            onDeleteComponent={onDeleteComponent}
                            onToggleHidden={onToggleHidden}
                            onDropComponent={onDropComponent}
                            onMoveEntity={onMoveEntity}
                            onEnterChild={onEnterChild}
                        />
                    ))
                )}
            </div>
        </aside>
    );
}

function pathsEqual(a: EntityPath | null, b: EntityPath | null): boolean {
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}

interface EntityNodeProps extends Omit<EditorHierarchyProps, 'entities'> {
    entity: InitialEntity;
    path: EntityPath;
    depth: number;
    ancestorHidden: boolean;
}

type DropZone = 'before' | 'into' | 'after' | null;

function EntityNode({
    entity,
    path,
    depth,
    ancestorHidden,
    hiddenPaths,
    selectedPath,
    selectedComponentIndex,
    onSelectEntity,
    onSelectComponent,
    onCreateEmptyEntity,
    onDeleteEntity,
    onDeleteComponent,
    onToggleHidden,
    onDropComponent,
    onMoveEntity,
    onEnterChild,
}: EntityNodeProps) {
    const [componentDragOver, setComponentDragOver] = useState(false);
    const [entityDropZone, setEntityDropZone] = useState<DropZone>(null);
    const [open, setOpen] = useState(true);

    const hasFocus = pathsEqual(selectedPath, path);
    const selectedEntityOnly = hasFocus && selectedComponentIndex === null;
    const selfHidden = hiddenPaths.has(pathKey(path));
    const effectivelyHidden = selfHidden || ancestorHidden;

    const acceptComponentDrag = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setComponentDragOver(true);
        }
    };

    const acceptEntityDrag = (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(ENTITY_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const ratio = (e.clientY - rect.top) / rect.height;
        const zone: DropZone = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'into';
        setEntityDropZone(zone);
    };

    const w = entity.transform.w ?? 0;
    const h = entity.transform.h ?? 0;
    const sizeBadge = w > 0 && h > 0 ? `${w}×${h}` : '—';
    const hasChildren = (entity.children?.length ?? 0) > 0;

    const handleRowClick = () => {
        // 既に選択中の親をクリックしたら最初の子に降りる (Figma 風 enter-into)
        if (selectedEntityOnly && hasChildren && open) {
            onEnterChild(path);
            return;
        }
        onSelectEntity(path);
        onSelectComponent(null);
    };

    const handleRowDoubleClick = () => {
        if (hasChildren) onEnterChild(path);
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column' })}>
            {/* drop zone (before) */}
            {entityDropZone === 'before' && <DropLine indentPx={4 + depth * INDENT_PX} />}
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    bg: selectedEntityOnly
                        ? 'primary'
                        : componentDragOver || entityDropZone === 'into'
                          ? 'primarySubtle'
                          : 'transparent',
                    color: selectedEntityOnly ? 'textOnPrimary' : 'text',
                    opacity: effectivelyHidden ? 0.45 : 1,
                    outline: componentDragOver || entityDropZone === 'into' ? '1px dashed' : 'none',
                    outlineColor: 'primary',
                    _hover: { bg: selectedEntityOnly ? 'primary' : 'surfaceHover' },
                })}
                style={{ paddingLeft: 8 + depth * INDENT_PX }}
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData(ENTITY_DRAG_MIME, pathKey(path));
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) acceptComponentDrag(e);
                    else acceptEntityDrag(e);
                }}
                onDragEnter={(e) => {
                    if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) acceptComponentDrag(e);
                    else acceptEntityDrag(e);
                }}
                onDragLeave={() => {
                    setComponentDragOver(false);
                    setEntityDropZone(null);
                }}
                onDrop={(e) => {
                    const ctype = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                    if (ctype) {
                        setComponentDragOver(false);
                        e.preventDefault();
                        e.stopPropagation();
                        onDropComponent(path, ctype);
                        return;
                    }
                    const fromKey = e.dataTransfer.getData(ENTITY_DRAG_MIME);
                    if (fromKey) {
                        const zone = entityDropZone;
                        setEntityDropZone(null);
                        e.preventDefault();
                        e.stopPropagation();
                        const from = fromKey.split('-').map(Number);
                        if (zone === 'into') {
                            onMoveEntity(from, path);
                        } else {
                            // before/after: 兄弟として挿入 (= 親の子の指定位置)。簡素化: into のみサポート。
                            // before/after は parentPath + sibling 位置だが Stage 4 で。今は「into」へ寄せる。
                            onMoveEntity(from, path);
                        }
                    }
                }}
                onClick={handleRowClick}
                onDoubleClick={handleRowDoubleClick}
            >
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        if (hasChildren || entity.components.length > 0) setOpen((p) => !p);
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
                    {hasChildren || entity.components.length > 0 ? <Chevron open={open} /> : <span />}
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
            {/* drop zone (after) */}
            {entityDropZone === 'after' && <DropLine indentPx={4 + depth * INDENT_PX} />}
            {open && (
                <div
                    className={css({
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                    })}
                >
                    {/* tree 縦線 (子があるときだけ表示) */}
                    {(hasChildren || entity.components.length > 0) && (
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
                    )}
                    {entity.components.map((c, ci) => {
                        const compSelected = hasFocus && selectedComponentIndex === ci;
                        return (
                            <ComponentRow
                                key={`${entity.id}::${ci}`}
                                type={c.type}
                                selected={compSelected}
                                hidden={effectivelyHidden}
                                indentPx={8 + (depth + 1) * INDENT_PX}
                                onClick={() => {
                                    onSelectEntity(path);
                                    onSelectComponent(ci);
                                }}
                                onDelete={() => onDeleteComponent(path, ci)}
                            />
                        );
                    })}
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
                            onSelectEntity={onSelectEntity}
                            onSelectComponent={onSelectComponent}
                            onCreateEmptyEntity={onCreateEmptyEntity}
                            onDeleteEntity={onDeleteEntity}
                            onDeleteComponent={onDeleteComponent}
                            onToggleHidden={onToggleHidden}
                            onDropComponent={onDropComponent}
                            onMoveEntity={onMoveEntity}
                            onEnterChild={onEnterChild}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ComponentRow({
    type,
    selected,
    hidden,
    indentPx,
    onClick,
    onDelete,
}: {
    type: string;
    selected: boolean;
    hidden: boolean;
    indentPx: number;
    onClick: () => void;
    onDelete: () => void;
}) {
    return (
        <div
            onClick={onClick}
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                bg: selected ? 'primarySubtle' : 'transparent',
                color: selected ? 'primary' : 'textMuted',
                opacity: hidden ? 0.45 : 1,
                _hover: { bg: selected ? 'primarySubtle' : 'surfaceHover' },
            })}
            style={{ paddingLeft: indentPx }}
        >
            <ComponentDotIcon />
            <span
                className={css({
                    flex: 1,
                    fontSize: '11px',
                    fontWeight: '500',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                })}
            >
                {type}
            </span>
            <button
                type="button"
                onClick={(ev) => {
                    ev.stopPropagation();
                    onDelete();
                }}
                aria-label="コンポーネント削除"
                title="このコンポーネントを削除"
                className={iconBtn(false)}
            >
                ×
            </button>
        </div>
    );
}

function DropLine({ indentPx }: { indentPx: number }) {
    return (
        <div
            className={css({
                height: '2px',
                bg: 'primary',
                borderRadius: '1px',
                margin: '0 4px',
            })}
            style={{ marginLeft: indentPx }}
            aria-hidden
        />
    );
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

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            aria-hidden="true"
        >
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}

function EyeIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function EyeOffIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <path d="M1 1l22 22" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
        >
            <path d="M12 5v14M5 12h14" />
        </svg>
    );
}

function ComponentDotIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="5" r="3" />
        </svg>
    );
}
