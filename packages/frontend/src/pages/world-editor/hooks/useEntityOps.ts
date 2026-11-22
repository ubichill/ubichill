/**
 * Entity CRUD + clipboard + duplicate + move + rename を 1 か所にまとめる。
 *
 * 受け取るもの: definition + updateEntities + selection (set 系) + 利用可能 kinds。
 * 返すもの: handleCreateEmptyEntity / Add / Delete / Rename / Move / Copy / Paste / Duplicate /
 *           EnterChild / patchTransform + hasClipboard。
 */
import { type InitialEntity, LIMITS, type WorldDefinition } from '@ubichill/shared';
import { useCallback, useMemo } from 'react';
import { entityWithComponentAt, withComponentAdded } from '../lib/addComponent';
import { DEFAULT_H, DEFAULT_W } from '../lib/dragHelpers';
import {
    adjustPathAfterDelete,
    buildUniqueEntityId,
    cloneEntitySubtree,
    collectEntityIds,
    deleteEntityAt,
    type EntityPath,
    getEntityAt,
    insertEntity,
    insertEntityAfter,
    moveEntity,
    nextRootZ,
    pathKey,
    renameEntity,
    toRenamedEntityId,
    updateEntityAt,
} from '../lib/entityTree';
import { placementFor } from '../lib/prefabPlacement';
import { fieldsOfKinds } from '../lib/referenceProblems';
import type { AvailableEntityKind } from './useAvailableEntityKinds';
import { useEntityClipboard } from './useEntityClipboard';

const DEFAULT_WORLD_SIZE = { width: 2000, height: 1500 };

interface UseEntityOpsOptions {
    definition: WorldDefinition;
    updateEntities: (mutate: (prev: InitialEntity[]) => InitialEntity[]) => void;
    kinds: AvailableEntityKind[];
    selection: {
        selectEntity: (path: EntityPath | null) => void;
        selectComponent: (componentIndex: number | null) => void;
        setSelectedPath: React.Dispatch<React.SetStateAction<EntityPath | null>>;
        setSelectedComponentIndex: React.Dispatch<React.SetStateAction<number | null>>;
        setHiddenPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
    };
    /** いま見えている範囲の真ん中（ワールド座標）。新しく置くものはここに出す。分からなければ null */
    viewCenter: () => { x: number; y: number } | null;
}

export interface UseEntityOpsResult {
    handleCreateEmptyEntity: (parentPath: EntityPath | null) => void;
    handleAddComponentToEntity: (path: EntityPath, componentType: string) => void;
    handleDeleteEntity: (path: EntityPath) => void;
    handleDeleteComponent: (path: EntityPath, componentIndex: number) => void;
    handleRenameEntity: (path: EntityPath, newId: string) => void;
    /** 表示名を変える（空なら外して id を出す） */
    handleSetEntityName: (path: EntityPath, name: string) => void;
    /** ワールドの空いたところに部品を落としたとき、その場所にその部品の Entity を作る */
    handleCreateEntityAt: (componentType: string, point: { x: number; y: number }) => void;
    handleMoveEntity: (from: EntityPath, to: EntityPath | null) => void;
    handleCopyEntity: (path: EntityPath) => void;
    handlePasteEntity: (parentPath: EntityPath | null) => void;
    handleDuplicateEntity: (path: EntityPath) => void;
    handleEnterChild: (path: EntityPath) => void;
    patchEntityTransform: (path: EntityPath, patch: Partial<InitialEntity['transform']>) => void;
    hasClipboard: boolean;
}

export function useEntityOps({
    definition,
    updateEntities,
    kinds,
    selection,
    viewCenter,
}: UseEntityOpsOptions): UseEntityOpsResult {
    const clipboard = useEntityClipboard();
    // 複製・貼り付け・改名で参照を付け替えるのに、どのフィールドが参照かを mod の宣言から引く
    const fieldsOf = useMemo(() => fieldsOfKinds(kinds), [kinds]);

    const patchEntityTransform = useCallback(
        (path: EntityPath, patch: Partial<InitialEntity['transform']>) => {
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({ ...e, transform: { ...e.transform, ...patch } })),
            );
        },
        [updateEntities],
    );

    const worldSize = definition.spec.environment?.worldSize ?? DEFAULT_WORLD_SIZE;
    const placeCenter = useCallback(
        () => viewCenter() ?? { x: worldSize.width / 2, y: worldSize.height / 2 },
        [viewCenter, worldSize.width, worldSize.height],
    );

    const handleCreateEmptyEntity = useCallback(
        (parentPath: EntityPath | null) => {
            const entities = definition.spec.initialEntities;
            const size = { x: 0, y: 0, width: DEFAULT_W, height: DEFAULT_H };
            const newEntity: InitialEntity = {
                id: buildUniqueEntityId('entity', collectEntityIds(entities)),
                transform: parentPath
                    ? { x: 0, y: 0, z: 1, w: DEFAULT_W, h: DEFAULT_H, scale: 1, rotation: 0 }
                    : {
                          ...placementFor(placeCenter(), size, worldSize),
                          z: nextRootZ(entities),
                          w: DEFAULT_W,
                          h: DEFAULT_H,
                          scale: 1,
                          rotation: 0,
                      },
                components: [],
                tags: [],
                children: [],
            };
            updateEntities((prev) => insertEntity(prev, parentPath, newEntity));
            if (parentPath) {
                const parent = getEntityAt(entities, parentPath);
                const newChildIdx = parent?.children?.length ?? 0;
                selection.selectEntity([...parentPath, newChildIdx]);
            } else {
                selection.selectEntity([entities.length]);
            }
            selection.selectComponent(null);
        },
        [definition.spec.initialEntities, placeCenter, worldSize, updateEntities, selection],
    );

    const handleCreateEntityAt = useCallback(
        (componentType: string, point: { x: number; y: number }) => {
            const entities = definition.spec.initialEntities;
            const kind = kinds.find((k) => k.kind === componentType);
            const created = entityWithComponentAt(componentType, kind, point, entities, worldSize);
            updateEntities((prev) => [...prev, created]);
            selection.selectEntity([entities.length]);
            selection.selectComponent(0);
        },
        [definition.spec.initialEntities, kinds, worldSize, updateEntities, selection],
    );

    const handleAddComponentToEntity = useCallback(
        (path: EntityPath, componentType: string) => {
            const kind = kinds.find((k) => k.kind === componentType);
            const target = getEntityAt(definition.spec.initialEntities, path);
            updateEntities((prev) => updateEntityAt(prev, path, (e) => withComponentAdded(e, componentType, kind)));
            selection.selectEntity(path);
            selection.selectComponent(target?.components.length ?? 0);
        },
        [kinds, updateEntities, definition.spec.initialEntities, selection],
    );

    const handleDeleteEntity = useCallback(
        (path: EntityPath) => {
            updateEntities((prev) => deleteEntityAt(prev, path));
            // 削除された path 以下の hiddenPaths キーを破棄 (path index ずれは諦めて単純化)
            selection.setHiddenPaths((prev) => {
                const next = new Set<string>();
                const removedKey = pathKey(path);
                for (const k of prev) {
                    if (k === removedKey || k.startsWith(`${removedKey}-`)) continue;
                    next.add(k);
                }
                return next;
            });
            selection.setSelectedPath((cur) => adjustPathAfterDelete(cur, path));
            selection.setSelectedComponentIndex(null);
        },
        [updateEntities, selection],
    );

    const handleDeleteComponent = useCallback(
        (path: EntityPath, componentIndex: number) => {
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({
                    ...e,
                    components: e.components.filter((_, ci) => ci !== componentIndex),
                })),
            );
            selection.setSelectedComponentIndex((cur) => {
                if (cur === null) return null;
                if (cur === componentIndex) return null;
                if (cur > componentIndex) return cur - 1;
                return cur;
            });
        },
        [updateEntities, selection],
    );

    const handleRenameEntity = useCallback(
        (path: EntityPath, newId: string) => {
            const taken = new Set(collectEntityIds(definition.spec.initialEntities));
            const self = getEntityAt(definition.spec.initialEntities, path);
            if (self) taken.delete(self.id);
            const uniqueId = toRenamedEntityId(newId, taken);
            if (uniqueId) updateEntities((prev) => renameEntity(prev, path, uniqueId, fieldsOf));
        },
        [updateEntities, definition.spec.initialEntities, fieldsOf],
    );

    const handleSetEntityName = useCallback(
        (path: EntityPath, name: string) => {
            const next = name.trim().slice(0, LIMITS.MAX_ENTITY_NAME_LENGTH);
            updateEntities((prev) =>
                updateEntityAt(prev, path, ({ name: _old, ...rest }) => (next ? { ...rest, name: next } : rest)),
            );
        },
        [updateEntities],
    );

    const handleMoveEntity = useCallback(
        (from: EntityPath, to: EntityPath | null) => {
            updateEntities((prev) => moveEntity(prev, from, to));
            // 移動後の selectedPath / hiddenPaths は厳密追跡が難しいので解除する
            selection.setSelectedPath(null);
            selection.setSelectedComponentIndex(null);
            selection.setHiddenPaths(new Set());
        },
        [updateEntities, selection],
    );

    const handleCopyEntity = useCallback(
        (path: EntityPath) => {
            const target = getEntityAt(definition.spec.initialEntities, path);
            if (target) clipboard.copy(target);
        },
        [clipboard, definition.spec.initialEntities],
    );

    const handlePasteEntity = useCallback(
        (parentPath: EntityPath | null) => {
            const source = clipboard.peek();
            if (!source) return;
            const taken = collectEntityIds(definition.spec.initialEntities);
            const cloned = cloneEntitySubtree(source, taken, fieldsOf);
            // ルートに貼り付け時のみ z をスタック頂上に持ち上げる (見えなくならないように)
            const placed = parentPath
                ? cloned
                : { ...cloned, transform: { ...cloned.transform, z: nextRootZ(definition.spec.initialEntities) } };
            updateEntities((prev) => insertEntity(prev, parentPath, placed));
            if (parentPath) {
                const parent = getEntityAt(definition.spec.initialEntities, parentPath);
                const newChildIdx = parent?.children?.length ?? 0;
                selection.selectEntity([...parentPath, newChildIdx]);
            } else {
                selection.selectEntity([definition.spec.initialEntities.length]);
            }
            selection.selectComponent(null);
        },
        [clipboard, definition.spec.initialEntities, updateEntities, selection, fieldsOf],
    );

    // 複製 (Cmd+D 相当: subtree をクローンして自分の直後に sibling 挿入)
    const handleDuplicateEntity = useCallback(
        (path: EntityPath) => {
            const source = getEntityAt(definition.spec.initialEntities, path);
            if (!source) return;
            const taken = collectEntityIds(definition.spec.initialEntities);
            const cloned = cloneEntitySubtree(source, taken, fieldsOf);
            const placed =
                path.length === 1
                    ? { ...cloned, transform: { ...cloned.transform, z: nextRootZ(definition.spec.initialEntities) } }
                    : cloned;
            updateEntities((prev) => insertEntityAfter(prev, path, placed));
            const newPath = [...path.slice(0, -1), path[path.length - 1] + 1];
            selection.selectEntity(newPath);
            selection.selectComponent(null);
        },
        [definition.spec.initialEntities, updateEntities, selection, fieldsOf],
    );

    const handleEnterChild = useCallback(
        (path: EntityPath) => {
            const parent = getEntityAt(definition.spec.initialEntities, path);
            if (!parent?.children?.length) return;
            selection.setSelectedPath([...path, 0]);
            selection.setSelectedComponentIndex(null);
        },
        [definition.spec.initialEntities, selection],
    );

    return {
        handleCreateEmptyEntity,
        handleAddComponentToEntity,
        handleDeleteEntity,
        handleDeleteComponent,
        handleRenameEntity,
        handleSetEntityName,
        handleCreateEntityAt,
        handleMoveEntity,
        handleCopyEntity,
        handlePasteEntity,
        handleDuplicateEntity,
        handleEnterChild,
        patchEntityTransform,
        hasClipboard: clipboard.hasClipboard,
    };
}
