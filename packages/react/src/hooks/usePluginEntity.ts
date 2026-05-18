/**
 * Ubi.entity.* RPC のハンドラ群。自 GameObject を基点に siblings / parent / children を解決する。
 */

import type { HostHandlers } from '@ubichill/sandbox';
import type { WorldEntity } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import { collectSubtreeGameObjectIds } from '../lib/entityScope';
import { useWorld } from './useWorld';

type EntityHandlers = Pick<
    HostHandlers,
    'onEntityGetSiblings' | 'onEntityGetParent' | 'onEntityGetChildren' | 'onEntityQuerySubtree'
>;

export function usePluginEntity(selfId: string, gameObjectId: string | undefined): EntityHandlers {
    const { entities } = useWorld();
    const entitiesRef = useRef(entities);
    useEffect(() => {
        entitiesRef.current = entities;
    });

    // gameObjectId → entities in that GameObject の事前 index
    const indexByGameObject = useMemo(() => {
        const map = new Map<string, WorldEntity[]>();
        for (const e of entities.values()) {
            if (!e.gameObjectId) continue;
            const arr = map.get(e.gameObjectId) ?? [];
            arr.push(e);
            map.set(e.gameObjectId, arr);
        }
        return map;
    }, [entities]);
    const indexRef = useRef(indexByGameObject);
    useEffect(() => {
        indexRef.current = indexByGameObject;
    });

    /** 親の gameObjectId を解決 (自 entity の parentGameObjectId)。 */
    const resolveParentId = (): string | undefined => {
        if (!gameObjectId) return undefined;
        for (const e of entitiesRef.current.values()) {
            if (e.gameObjectId === gameObjectId && e.parentGameObjectId) return e.parentGameObjectId;
        }
        return undefined;
    };

    /** 直接の子 gameObjectId 集合 (parentGameObjectId === gameObjectId)。 */
    const resolveChildIds = (): Set<string> => {
        const set = new Set<string>();
        if (!gameObjectId) return set;
        for (const e of entitiesRef.current.values()) {
            if (e.parentGameObjectId === gameObjectId && e.gameObjectId) set.add(e.gameObjectId);
        }
        return set;
    };

    return {
        onEntityGetSiblings: () => {
            if (!gameObjectId) return [];
            return (indexRef.current.get(gameObjectId) ?? []).filter((e) => e.id !== selfId);
        },
        onEntityGetParent: (entityType?: string) => {
            const parentId = resolveParentId();
            if (!parentId) return [];
            const list = indexRef.current.get(parentId) ?? [];
            return entityType ? list.filter((e) => e.type === entityType) : list;
        },
        onEntityGetChildren: (entityType?: string) => {
            const childIds = resolveChildIds();
            const out: WorldEntity[] = [];
            for (const id of childIds) {
                const list = indexRef.current.get(id) ?? [];
                for (const e of list) if (!entityType || e.type === entityType) out.push(e);
            }
            return out;
        },
        onEntityQuerySubtree: (entityType: string) => {
            if (!gameObjectId) return [];
            const subtree = collectSubtreeGameObjectIds(entitiesRef.current.values(), gameObjectId);
            const out: WorldEntity[] = [];
            for (const e of entitiesRef.current.values()) {
                if (e.type === entityType && e.gameObjectId && subtree.has(e.gameObjectId)) out.push(e);
            }
            return out;
        },
    };
}
