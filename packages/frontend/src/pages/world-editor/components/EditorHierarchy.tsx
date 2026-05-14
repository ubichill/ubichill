import type { InitialEntity } from '@ubichill/shared';
import { useState } from 'react';
import { css } from '@/styled-system/css';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';

interface EditorHierarchyProps {
    entities: InitialEntity[];
    selectedEntityIndex: number | null;
    selectedComponentIndex: number | null;
    hiddenIndices: Set<number>;
    onSelectEntity: (index: number | null) => void;
    onSelectComponent: (componentIndex: number | null) => void;
    onCreateEmptyEntity: () => void;
    onDeleteEntity: (index: number) => void;
    onDeleteComponent: (entityIndex: number, componentIndex: number) => void;
    onToggleHidden: (index: number) => void;
    /** Component カードを Entity 行へ drop したときの追加。 */
    onDropComponent: (entityIndex: number, componentType: string) => void;
}

export function EditorHierarchy({
    entities,
    selectedEntityIndex,
    selectedComponentIndex,
    hiddenIndices,
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
                    onClick={onCreateEmptyEntity}
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
                        まだエンティティがありません。「+ Entity」を押すか、アセットからコンポーネントを Entity
                        行にドロップしてください。
                    </div>
                ) : (
                    entities.map((entity, i) => {
                        const entitySelected = i === selectedEntityIndex && selectedComponentIndex === null;
                        const entityHasFocus = i === selectedEntityIndex;
                        const hidden = hiddenIndices.has(i);
                        return (
                            <EntityNode
                                key={entity.id}
                                entity={entity}
                                entityIndex={i}
                                selected={entitySelected}
                                hasFocus={entityHasFocus}
                                hidden={hidden}
                                selectedComponentIndex={entityHasFocus ? selectedComponentIndex : null}
                                onSelectEntity={(idx) => {
                                    onSelectEntity(idx);
                                    onSelectComponent(null);
                                }}
                                onSelectComponent={(idx, ci) => {
                                    onSelectEntity(idx);
                                    onSelectComponent(ci);
                                }}
                                onToggleHidden={() => onToggleHidden(i)}
                                onDeleteEntity={() => onDeleteEntity(i)}
                                onDeleteComponent={(ci) => onDeleteComponent(i, ci)}
                                onDropComponent={(type) => onDropComponent(i, type)}
                            />
                        );
                    })
                )}
            </div>
        </aside>
    );
}

interface EntityNodeProps {
    entity: InitialEntity;
    entityIndex: number;
    selected: boolean;
    hasFocus: boolean;
    hidden: boolean;
    selectedComponentIndex: number | null;
    onSelectEntity: (index: number) => void;
    onSelectComponent: (index: number, componentIndex: number) => void;
    onToggleHidden: () => void;
    onDeleteEntity: () => void;
    onDeleteComponent: (componentIndex: number) => void;
    onDropComponent: (componentType: string) => void;
}

function EntityNode({
    entity,
    entityIndex,
    selected,
    hasFocus,
    hidden,
    selectedComponentIndex,
    onSelectEntity,
    onSelectComponent,
    onToggleHidden,
    onDeleteEntity,
    onDeleteComponent,
    onDropComponent,
}: EntityNodeProps) {
    const [dragOver, setDragOver] = useState(false);

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
                onDropComponent(type);
            }}
        >
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    bg: selected ? 'primary' : dragOver ? 'primarySubtle' : 'transparent',
                    color: selected ? 'textOnPrimary' : 'text',
                    opacity: hidden ? 0.45 : 1,
                    outline: dragOver ? '1px dashed' : 'none',
                    outlineColor: 'primary',
                    _hover: { bg: selected ? 'primary' : 'surfaceHover' },
                })}
                onClick={() => onSelectEntity(entityIndex)}
            >
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        onToggleHidden();
                    }}
                    aria-label={hidden ? '表示' : '非表示'}
                    title={hidden ? '表示する' : '非表示にする'}
                    className={css({
                        flexShrink: 0,
                        width: '22px',
                        height: '22px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bg: 'transparent',
                        border: 'none',
                        color: selected ? 'textOnPrimary' : 'textMuted',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        _hover: { bg: 'surfaceHover' },
                    })}
                >
                    {hidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <div
                    className={css({
                        flex: 1,
                        minW: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1px',
                    })}
                >
                    <span
                        className={css({
                            fontSize: '12px',
                            fontWeight: '600',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textDecoration: hidden ? 'line-through' : 'none',
                        })}
                    >
                        {entity.id}
                    </span>
                    <span
                        className={css({
                            fontSize: '10px',
                            opacity: 0.7,
                        })}
                    >
                        ({Math.round(entity.transform.x)}, {Math.round(entity.transform.y)}) · {sizeBadge} ·{' '}
                        {entity.components.length}c
                    </span>
                </div>
                <button
                    type="button"
                    onClick={(ev) => {
                        ev.stopPropagation();
                        onDeleteEntity();
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
                        color: selected ? 'textOnPrimary' : 'textSubtle',
                        opacity: 0.7,
                        cursor: 'pointer',
                        borderRadius: '4px',
                        fontSize: '14px',
                        lineHeight: '1',
                        _hover: { opacity: 1, bg: 'surfaceHover' },
                    })}
                >
                    ×
                </button>
            </div>
            {entity.components.length > 0 && (
                <div className={css({ display: 'flex', flexDirection: 'column' })}>
                    {entity.components.map((c, ci) => {
                        const compSelected = hasFocus && selectedComponentIndex === ci;
                        return (
                            <ComponentRow
                                key={`${entity.id}::${ci}`}
                                type={c.type}
                                selected={compSelected}
                                hidden={hidden}
                                onClick={() => onSelectComponent(entityIndex, ci)}
                                onDelete={() => onDeleteComponent(ci)}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

interface ComponentRowProps {
    type: string;
    selected: boolean;
    hidden: boolean;
    onClick: () => void;
    onDelete: () => void;
}

function ComponentRow({ type, selected, hidden, onClick, onDelete }: ComponentRowProps) {
    return (
        <div
            onClick={onClick}
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px 4px 24px',
                borderRadius: '6px',
                cursor: 'pointer',
                bg: selected ? 'primarySubtle' : 'transparent',
                color: selected ? 'primary' : 'textMuted',
                opacity: hidden ? 0.45 : 1,
                _hover: { bg: selected ? 'primarySubtle' : 'surfaceHover' },
            })}
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
