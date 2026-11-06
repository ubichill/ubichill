import { useWorld } from '@ubichill/react';
import { conflictedMediaSurfaces, findMediaConflicts } from '@ubichill/shared';
import { useMemo } from 'react';
import { useModRegistry } from './ModRegistryContext';

/**
 * 競合していて動画を描かない動画面（core:media の Entity）。判定は World Editor・ubichill dev と同じ
 * `findMediaConflicts`。読み込んだ mod の宣言（dataFields）で数えるので、まだ読み込んでいない mod の出力は数えない。
 */
export function useConflictedMediaSurfaces(): ReadonlySet<string> {
    const { entities } = useWorld();
    const { modMap } = useModRegistry();
    return useMemo(
        () =>
            conflictedMediaSurfaces(
                findMediaConflicts(
                    [...entities.values()].map((e) => ({
                        key: e.id,
                        entityId: e.entityId ?? e.id,
                        type: e.type,
                        data: e.data as Record<string, unknown> | undefined,
                    })),
                    (type) => {
                        const definition = modMap.get(type);
                        return definition && 'dataFields' in definition ? definition.dataFields : undefined;
                    },
                ),
            ),
        [entities, modMap],
    );
}
