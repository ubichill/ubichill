/**
 * ワールドの進行（衝突判定など）を Host のループに載せる。1 ワールドにつき 1 回だけ呼ぶ。
 *
 * collider の一覧はここで `entities` から作って渡す。sandbox / runtime は Entity の保管庫を
 * 持たないので、「今ワールドに何があるか」を知っている React 側が供給する役になる。
 */
import { CORE_COMPONENT_TYPES } from '@ubichill/core-components';
import type { ColliderData, ColliderInstance } from '@ubichill/runtime';
import { startWorldSimulation, stopWorldSimulation } from '@ubichill/sandbox';
import type { ComponentInstance } from '@ubichill/shared';
import { useEffect, useRef } from 'react';

/** ワールドの ComponentInstance から collider だけを取り出す。 */
export function collectColliders(entities: ReadonlyMap<string, ComponentInstance>): ColliderInstance[] {
    const colliders: ColliderInstance[] = [];
    for (const entity of entities.values()) {
        if (entity.type !== CORE_COMPONENT_TYPES.collider) continue;
        colliders.push({
            id: entity.id,
            entityId: entity.entityId,
            transform: entity.transform,
            data: entity.data as ColliderData,
        });
    }
    return colliders;
}

export function useWorldSimulation(entities: ReadonlyMap<string, ComponentInstance>, key = 'world'): void {
    // 毎フレーム最新の entities を読むための ref。entities の更新でループを張り直さない。
    const entitiesRef = useRef(entities);
    entitiesRef.current = entities;

    useEffect(() => {
        startWorldSimulation(key, { getColliders: () => collectColliders(entitiesRef.current) });
        return () => stopWorldSimulation(key);
    }, [key]);
}
