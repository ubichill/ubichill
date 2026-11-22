import { instantiatePrefab, type WorldDefinition, WorldDefinitionSchema } from '@ubichill/shared';
import { useCallback } from 'react';
import type { EditorPackage } from '@/lib/mods/packages';
import type { PrefabDragRef } from '../lib/dnd';
import { type EntityPath, getEntityAt, insertEntity, nextRootZ } from '../lib/entityTree';
import { contentBounds, placementFor } from '../lib/prefabPlacement';

const DEFAULT_WORLD_SIZE = { width: 2000, height: 1500 };

/** プレハブを置く先。point が無ければ、ルートは見えている範囲の真ん中、子は親の真ん中に置く */
export interface PrefabDestination {
    parent: EntityPath | null;
    point: { x: number; y: number } | null;
}

/**
 * アセットのプレハブを、元との関連を持ったまま一式で置き、置いた親を選ぶ。中身の真ん中が置く場所に来るようにし、
 * ルートに置くときはワールドからはみ出さないように寄せる。
 */
export function usePrefabPlacement({
    definition,
    setDefinition,
    packages,
    selectEntity,
    viewCenter,
    onError,
}: {
    definition: WorldDefinition;
    setDefinition: (next: WorldDefinition) => void;
    packages: EditorPackage[];
    selectEntity: (path: EntityPath | null) => void;
    viewCenter: () => { x: number; y: number } | null;
    onError: (message: string) => void;
}) {
    return useCallback(
        (ref: PrefabDragRef, where: PrefabDestination) => {
            const pkg = packages.find((p) => p.entry.id === ref.modId);
            const prefab = pkg?.manifest.prefabs?.[ref.name];
            if (!pkg || !prefab) {
                onError('このプレハブが見つかりません。mod の一覧を確かめてください');
                return;
            }
            const entities = definition.spec.initialEntities;
            const parent = where.parent ? getEntityAt(entities, where.parent) : null;
            const worldSize = definition.spec.environment?.worldSize ?? DEFAULT_WORLD_SIZE;
            const point =
                where.point ??
                (parent
                    ? { x: (parent.transform.w ?? 0) / 2, y: (parent.transform.h ?? 0) / 2 }
                    : (viewCenter() ?? { x: worldSize.width / 2, y: worldSize.height / 2 }));
            const at = placementFor(point, contentBounds(prefab.entities), parent ? undefined : worldSize);
            try {
                const placed = instantiatePrefab(pkg.entry, ref.name, prefab, pkg.manifest.components, entities, {
                    ...at,
                    // ルートは一番上に重ねる（先に置いた背景の下に隠れないように）
                    z: parent ? 1 : nextRootZ(entities),
                });
                setDefinition(
                    WorldDefinitionSchema.parse({
                        ...definition,
                        spec: { ...definition.spec, initialEntities: insertEntity(entities, where.parent, placed) },
                    }),
                );
                selectEntity(where.parent && parent ? [...where.parent, parent.children.length] : [entities.length]);
            } catch (e) {
                onError(e instanceof Error ? e.message : '置けませんでした');
            }
        },
        [definition, setDefinition, packages, selectEntity, viewCenter, onError],
    );
}
