/**
 * Ubi.entity.* RPC のハンドラ群。自 GameObject を基点に siblings / parent / children を解決する。
 */

import type { HostHandlers } from '@ubichill/sandbox';
import type { ComponentInstance } from '@ubichill/shared';
import { useEffect, useMemo, useRef } from 'react';
import { collectSubtreeGameObjectIds } from '../lib/entityScope';
import { useWorld } from './useWorld';

type EntityHandlers = Pick<
    HostHandlers,
    'onEntityGetSiblings' | 'onEntityGetParent' | 'onEntityGetChildren' | 'onEntityQuerySubtree'
>;

export function usePluginEntity(selfId: string, entityId: string | undefined): EntityHandlers {
    const { entities } = useWorld();
    const entitiesRef = useRef(entities);
    useEffect(() => {
        entitiesRef.current = entities;
    });

    // entityId → entities in that GameObject の事前 index
    const indexByGameObject = useMemo(() => {
        const map = new Map<string, ComponentInstance[]>();
        for (const e of entities.values()) {
            if (!e.entityId) continue;
            const arr = map.get(e.entityId) ?? [];
            arr.push(e);
            map.set(e.entityId, arr);
        }
        return map;
    }, [entities]);
    const indexRef = useRef(indexByGameObject);
    useEffect(() => {
        indexRef.current = indexByGameObject;
    });

    /** 親の entityId を解決 (自 entity の parentEntityId)。 */
    const resolveParentId = (): string | undefined => {
        if (!entityId) return undefined;
        for (const e of entitiesRef.current.values()) {
            if (e.entityId === entityId && e.parentEntityId) return e.parentEntityId;
        }
        return undefined;
    };

    /** 直接の子 entityId 集合 (parentEntityId === entityId)。 */
    const resolveChildIds = (): Set<string> => {
        const set = new Set<string>();
        if (!entityId) return set;
        for (const e of entitiesRef.current.values()) {
            if (e.parentEntityId === entityId && e.entityId) set.add(e.entityId);
        }
        return set;
    };

    return {
        onEntityGetSiblings: () => {
            if (!entityId) return [];
            return (indexRef.current.get(entityId) ?? []).filter((e) => e.id !== selfId);
        },
        onEntityGetParent: (entityType?: string) => {
            const parentId = resolveParentId();
            if (!parentId) return [];
            const list = indexRef.current.get(parentId) ?? [];
            return entityType ? list.filter((e) => e.type === entityType) : list;
        },
        onEntityGetChildren: (entityType?: string) => {
            const childIds = resolveChildIds();
            const out: ComponentInstance[] = [];
            for (const id of childIds) {
                const list = indexRef.current.get(id) ?? [];
                for (const e of list) if (!entityType || e.type === entityType) out.push(e);
            }
            return out;
        },
        onEntityQuerySubtree: (entityType: string) => {
            if (!entityId) return [];
            const subtree = collectSubtreeGameObjectIds(entitiesRef.current.values(), entityId);
            const out: ComponentInstance[] = [];
            for (const e of entitiesRef.current.values()) {
                if (e.type === entityType && e.entityId && subtree.has(e.entityId)) out.push(e);
            }
            return out;
        },
    };
}
