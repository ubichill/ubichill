/**
 * Entity CRUD + clipboard + duplicate + move + rename を 1 か所にまとめる。
 *
 * 受け取るもの: definition + updateEntities + selection (set 系) + 利用可能 kinds。
 * 返すもの: handleCreateEmptyEntity / Add / Delete / Rename / Move / Copy / Paste / Duplicate /
 *           EnterChild / patchTransform + hasClipboard。
 */
import type { EntityComponentDef, InitialEntity, WorldDefinition } from '@ubichill/shared';
import { useCallback } from 'react';
import { DEFAULT_H, DEFAULT_W } from '../lib/dragHelpers';
import {
    adjustPathAfterDelete,
    buildUniqueEntityId,
    cloneEntitySubtree,
    collectEntityIds,
    deleteEntityAt,
    type EntityPath,
    ensureUniqueName,
    getEntityAt,
    insertEntity,
    insertEntityAfter,
    moveEntity,
    nextRootZ,
    pathKey,
    updateEntityAt,
} from '../lib/entityTree';
import type { AvailableEntityKind } from './useAvailableEntityKinds';
import { useEntityClipboard } from './useEntityClipboard';

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
}

export interface UseEntityOpsResult {
    handleCreateEmptyEntity: (parentPath: EntityPath | null) => void;
    handleAddComponentToEntity: (path: EntityPath, componentType: string) => void;
    handleDeleteEntity: (path: EntityPath) => void;
    handleDeleteComponent: (path: EntityPath, componentIndex: number) => void;
    handleRenameEntity: (path: EntityPath, newId: string) => void;
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
}: UseEntityOpsOptions): UseEntityOpsResult {
    const clipboard = useEntityClipboard();

    const patchEntityTransform = useCallback(
        (path: EntityPath, patch: Partial<InitialEntity['transform']>) => {
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({ ...e, transform: { ...e.transform, ...patch } })),
            );
        },
        [updateEntities],
    );

    const handleCreateEmptyEntity = useCallback(
        (parentPath: EntityPath | null) => {
            const env = definition.spec.environment;
            const worldSize = env?.worldSize ?? { width: 2000, height: 1500 };
            const entities = definition.spec.initialEntities;
            const newEntity: InitialEntity = {
                id: buildUniqueEntityId('entity', collectEntityIds(entities)),
                transform: parentPath
                    ? { x: 0, y: 0, z: 1, w: DEFAULT_W, h: DEFAULT_H, scale: 1, rotation: 0 }
                    : {
                          x: Math.round(worldSize.width / 2 - DEFAULT_W / 2),
                          y: Math.round(worldSize.height / 2 - DEFAULT_H / 2),
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
        [definition.spec.initialEntities, definition.spec.environment, updateEntities, selection],
    );

    const handleAddComponentToEntity = useCallback(
        (path: EntityPath, componentType: string) => {
            const kind = kinds.find((k) => k.kind === componentType);
            const initialData: Record<string, unknown> = {};
            if (kind?.dataFields) {
                for (const [name, spec] of Object.entries(kind.dataFields)) {
                    if (spec.default !== undefined) initialData[name] = spec.default;
                }
            }
            const newComponent: EntityComponentDef = { type: componentType, data: initialData };
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({ ...e, components: [...e.components, newComponent] })),
            );
            const target = getEntityAt(definition.spec.initialEntities, path);
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
            const uniqueId = ensureUniqueName(newId, taken);
            updateEntities((prev) => updateEntityAt(prev, path, (e) => ({ ...e, id: uniqueId })));
        },
        [updateEntities, definition.spec.initialEntities],
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
            const cloned = cloneEntitySubtree(source, taken);
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
        [clipboard, definition.spec.initialEntities, updateEntities, selection],
    );

    // 複製 (Cmd+D 相当: subtree をクローンして自分の直後に sibling 挿入)
    const handleDuplicateEntity = useCallback(
        (path: EntityPath) => {
            const source = getEntityAt(definition.spec.initialEntities, path);
            if (!source) return;
            const taken = collectEntityIds(definition.spec.initialEntities);
            const cloned = cloneEntitySubtree(source, taken);
            const placed =
                path.length === 1
                    ? { ...cloned, transform: { ...cloned.transform, z: nextRootZ(definition.spec.initialEntities) } }
                    : cloned;
            updateEntities((prev) => insertEntityAfter(prev, path, placed));
            const newPath = [...path.slice(0, -1), path[path.length - 1] + 1];
            selection.selectEntity(newPath);
            selection.selectComponent(null);
        },
        [definition.spec.initialEntities, updateEntities, selection],
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
        handleMoveEntity,
        handleCopyEntity,
        handlePasteEntity,
        handleDuplicateEntity,
        handleEnterChild,
        patchEntityTransform,
        hasClipboard: clipboard.hasClipboard,
    };
}
