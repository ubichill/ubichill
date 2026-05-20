import type { InitialEntity } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';
import { type EntityPath, pathKey } from '../lib/entityTree';

const ENTITY_DRAG_MIME = 'application/x-ubichill-entity-path';
const INDENT_PX = 16;
/** dragOverKey の特別値: ヒエラルキー余白 (ルートへの drop)。 */
const ROOT_DROP_KEY = '__root__';

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
    // ドラッグ中にハイライトする drop ターゲットの key (path-key または ROOT_DROP_KEY)。
    // 1 つだけ保持するので state が滞留しない。dragend で必ず null にする。
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const clearDragHover = useCallback(() => setDragOverKey(null), []);
    useEffect(() => {
        // dragend は source 上で発火しバブルするので window で全部受け取れる。
        // ドロップ成功/失敗/Esc キャンセル すべてで発火する → 滞留を防ぐ唯一の信頼できる経路。
        window.addEventListener('dragend', clearDragHover);
        return () => window.removeEventListener('dragend', clearDragHover);
    }, [clearDragHover]);

    const acceptRootDrag = (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(ENTITY_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverKey(ROOT_DROP_KEY);
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
                    outline: '2px dashed transparent',
                    outlineOffset: '-4px',
                    '&::-webkit-scrollbar': { width: '6px' },
                    '&::-webkit-scrollbar-thumb': { backgroundColor: 'primarySubtle', borderRadius: '3px' },
                })}
                style={{
                    outlineColor: dragOverKey === ROOT_DROP_KEY ? 'var(--colors-primary, #007aff)' : 'transparent',
                }}
                onClick={(e) => {
                    if (e.target === e.currentTarget) onSelectEntity(null);
                }}
                onDragOver={acceptRootDrag}
                onDragEnter={acceptRootDrag}
                onDrop={(e) => {
                    const fromKey = e.dataTransfer.getData(ENTITY_DRAG_MIME);
                    setDragOverKey(null);
                    if (!fromKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onMoveEntity(fromKey.split('-').map(Number), null);
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
    dragOverKey: string | null;
    setDragOverKey: (key: string | null) => void;
}

function EntityNode({
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
}: EntityNodeProps) {
    const [open, setOpen] = useState(true);

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
    // 別の行に移ったら、その行が setDragOverKey で上書きするので滞留しない。
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
            {open && (
                <div
                    className={css({
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                    })}
                >
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
            <span className={css({ flex: 1, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' })}>
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
            strokeLinecap="round"
            aria-hidden="true"
        >
            <path d="M12 5v14M5 12h14" />
        </svg>
    );
}

function ComponentDotIcon() {
    return (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <circle cx="4" cy="4" r="3" fill="currentColor" />
        </svg>
    );
}
