import type { InitialEntity } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { ENTITY_DRAG_MIME, ROOT_DROP_KEY } from '../../lib/dnd';
import type { EntityPath } from '../../lib/entityTree';
import { EntityContextMenu, type EntityContextMenuItem } from './EntityContextMenu';
import { EntityNode } from './EntityNode';
import { PlusIcon } from './hierarchyIcons';

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
    /** subtree をクリップボードへ */
    onCopyEntity: (path: EntityPath) => void;
    /** クリップボードから貼り付け (parentPath=null ならルート) */
    onPasteEntity: (parentPath: EntityPath | null) => void;
    /** クリップボードに何か入っているか (paste メニューの有効/無効判定) */
    hasClipboard: boolean;
}

interface ContextMenuState {
    path: EntityPath;
    x: number;
    y: number;
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
    onCopyEntity,
    onPasteEntity,
    hasClipboard,
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

    // ── 右クリック context menu ─────────────────────────────
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const openContextMenu = useCallback((path: EntityPath, x: number, y: number) => {
        setContextMenu({ path, x, y });
    }, []);
    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    // メニュー項目 (右クリック対象の path に応じて build)
    const buildMenuItems = (path: EntityPath): EntityContextMenuItem[] => [
        {
            label: 'コピー',
            onClick: () => onCopyEntity(path),
        },
        {
            label: '貼り付け (子として)',
            onClick: () => onPasteEntity(path),
            disabled: !hasClipboard,
        },
        {
            label: '子 Entity を追加',
            onClick: () => onCreateEmptyEntity(path),
            separatorAbove: true,
        },
        {
            label: '削除',
            onClick: () => onDeleteEntity(path),
            danger: true,
            separatorAbove: true,
        },
    ];

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
                onContextMenu={(e) => {
                    // 空白部分の右クリック → ルートに貼り付け
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                    setContextMenu({ path: [], x: e.clientX, y: e.clientY });
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
                            onContextMenu={openContextMenu}
                        />
                    ))
                )}
            </div>
            {contextMenu && (
                <EntityContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={
                        contextMenu.path.length === 0
                            ? [
                                  // 空白部分のメニュー: ルートに貼り付けのみ
                                  {
                                      label: 'ルートに貼り付け',
                                      onClick: () => onPasteEntity(null),
                                      disabled: !hasClipboard,
                                  },
                              ]
                            : buildMenuItems(contextMenu.path)
                    }
                    onClose={closeContextMenu}
                />
            )}
        </aside>
    );
}
