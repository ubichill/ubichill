import type { InitialEntity } from '@ubichill/shared';
import { useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';

/** ヒエラルキー内で Entity を指す path (ルートからの index 列)。例: [0] / [0, 1] */
export type EntityPath = number[];

interface EditorHierarchyProps {
    entities: InitialEntity[];
    selectedPath: EntityPath | null;
    /** Component index (null なら Entity 全体が選択中) */
    selectedComponentIndex: number | null;
    /** ローカル非表示にしている **ルート** Entity の index 集合 */
    hiddenRootIndices: Set<number>;
    onSelectEntity: (path: EntityPath | null) => void;
    onSelectComponent: (componentIndex: number | null) => void;
    onCreateEmptyEntity: (parentPath: EntityPath | null) => void;
    onDeleteEntity: (path: EntityPath) => void;
    onDeleteComponent: (path: EntityPath, componentIndex: number) => void;
    onToggleHidden: (rootIndex: number) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
}

export function EditorHierarchy({
    entities,
    selectedPath,
    selectedComponentIndex,
    hiddenRootIndices,
    onSelectEntity,
    onSelectComponent,
    onCreateEmptyEntity,
    onDeleteEntity,
    onDeleteComponent,
    onToggleHidden,
    onDropComponent,
}: EditorHierarchyProps) {
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
                    '&::-webkit-scrollbar': { width: '6px' },
                    '&::-webkit-scrollbar-thumb': { backgroundColor: 'primarySubtle', borderRadius: '3px' },
                })}
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
                        まだエンティティがありません。「+ Entity」を押すか、アセットからコンポーネントを drop
                        してください。
                    </div>
                ) : (
                    entities.map((entity, i) => (
                        <EntityNode
                            key={entity.id}
                            entity={entity}
                            path={[i]}
                            depth={0}
                            rootIndex={i}
                            rootHidden={hiddenRootIndices.has(i)}
                            selectedPath={selectedPath}
                            selectedComponentIndex={selectedComponentIndex}
                            onSelectEntity={onSelectEntity}
                            onSelectComponent={onSelectComponent}
                            onCreateChild={onCreateEmptyEntity}
                            onDeleteEntity={onDeleteEntity}
                            onDeleteComponent={onDeleteComponent}
                            onToggleHidden={onToggleHidden}
                            onDropComponent={onDropComponent}
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

interface EntityNodeProps {
    entity: InitialEntity;
    path: EntityPath;
    depth: number;
    rootIndex: number;
    rootHidden: boolean;
    selectedPath: EntityPath | null;
    selectedComponentIndex: number | null;
    onSelectEntity: (path: EntityPath | null) => void;
    onSelectComponent: (componentIndex: number | null) => void;
    onCreateChild: (parentPath: EntityPath) => void;
    onDeleteEntity: (path: EntityPath) => void;
    onDeleteComponent: (path: EntityPath, componentIndex: number) => void;
    onToggleHidden: (rootIndex: number) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
}

function EntityNode({
    entity,
    path,
    depth,
    rootIndex,
    rootHidden,
    selectedPath,
    selectedComponentIndex,
    onSelectEntity,
    onSelectComponent,
    onCreateChild,
    onDeleteEntity,
    onDeleteComponent,
    onToggleHidden,
    onDropComponent,
}: EntityNodeProps) {
    const [dragOver, setDragOver] = useState(false);
    const [open, setOpen] = useState(true);

    const hasFocus = pathsEqual(selectedPath, path);
    const selectedEntityOnly = hasFocus && selectedComponentIndex === null;

    const acceptComponentDrag = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
        }
    };

    const w = entity.transform.w ?? 0;
    const h = entity.transform.h ?? 0;
    const sizeBadge = w > 0 && h > 0 ? `${w}×${h}` : '—';
    const hasChildren = (entity.children?.length ?? 0) > 0;

    return (
        <div
            className={css({ display: 'flex', flexDirection: 'column' })}
            onDragOver={acceptComponentDrag}
            onDragEnter={acceptComponentDrag}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                const type = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                setDragOver(false);
                if (!type) return;
                e.preventDefault();
                e.stopPropagation();
                onDropComponent(path, type);
            }}
        >
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    bg: selectedEntityOnly ? 'primary' : dragOver ? 'primarySubtle' : 'transparent',
                    color: selectedEntityOnly ? 'textOnPrimary' : 'text',
                    opacity: rootHidden ? 0.45 : 1,
                    outline: dragOver ? '1px dashed' : 'none',
                    outlineColor: 'primary',
                    _hover: { bg: selectedEntityOnly ? 'primary' : 'surfaceHover' },
                })}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => {
                    onSelectEntity(path);
                    onSelectComponent(null);
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
                {depth === 0 && (
                    <button
                        type="button"
                        onClick={(ev) => {
                            ev.stopPropagation();
                            onToggleHidden(rootIndex);
                        }}
                        aria-label={rootHidden ? '表示' : '非表示'}
                        title={rootHidden ? '表示する' : '非表示にする'}
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
                        {rootHidden ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                )}
                <div className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column', gap: '1px' })}>
                    <span
                        className={css({
                            fontSize: '12px',
                            fontWeight: '600',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textDecoration: rootHidden ? 'line-through' : 'none',
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
                        onCreateChild(path);
                    }}
                    aria-label="子 Entity を追加"
                    title="子 Entity を追加"
                    className={css({
                        flexShrink: 0,
                        width: '20px',
                        height: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bg: 'transparent',
                        border: 'none',
                        color: selectedEntityOnly ? 'textOnPrimary' : 'textSubtle',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '12px',
                        _hover: { opacity: 1, bg: 'surfaceHover' },
                    })}
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
                    className={css({
                        flexShrink: 0,
                        width: '20px',
                        height: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bg: 'transparent',
                        border: 'none',
                        color: selectedEntityOnly ? 'textOnPrimary' : 'textSubtle',
                        opacity: 0.7,
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px',
                        _hover: { opacity: 1, bg: 'surfaceHover' },
                    })}
                >
                    ×
                </button>
            </div>
            {open && (
                <div className={css({ display: 'flex', flexDirection: 'column' })}>
                    {entity.components.map((c, ci) => {
                        const compSelected = hasFocus && selectedComponentIndex === ci;
                        return (
                            <ComponentRow
                                key={`${entity.id}::${ci}`}
                                type={c.type}
                                selected={compSelected}
                                hidden={rootHidden}
                                indentPx={8 + (depth + 1) * 14}
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
                            rootIndex={rootIndex}
                            rootHidden={rootHidden}
                            selectedPath={selectedPath}
                            selectedComponentIndex={selectedComponentIndex}
                            onSelectEntity={onSelectEntity}
                            onSelectComponent={onSelectComponent}
                            onCreateChild={onCreateChild}
                            onDeleteEntity={onDeleteEntity}
                            onDeleteComponent={onDeleteComponent}
                            onToggleHidden={onToggleHidden}
                            onDropComponent={onDropComponent}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface ComponentRowProps {
    type: string;
    selected: boolean;
    hidden: boolean;
    indentPx: number;
    onClick: () => void;
    onDelete: () => void;
}

function ComponentRow({ type, selected, hidden, indentPx, onClick, onDelete }: ComponentRowProps) {
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
                className={css({
                    flexShrink: 0,
                    width: '18px',
                    height: '18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bg: 'transparent',
                    border: 'none',
                    color: 'textSubtle',
                    opacity: 0.7,
                    cursor: 'pointer',
                    borderRadius: '4px',
                    fontSize: '12px',
                    lineHeight: '1',
                    _hover: { opacity: 1, bg: 'surfaceHover' },
                })}
            >
                ×
            </button>
        </div>
    );
}

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
