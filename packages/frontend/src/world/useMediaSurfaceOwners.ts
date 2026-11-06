import { useWorld } from '@ubichill/react';
import { findMediaConflicts, type MediaConflicts } from '@ubichill/shared';
import { useMemo } from 'react';
import { useModRegistry } from './ModRegistryContext';
import { mediaRecordOf } from './mediaSurfaceRecords';

/**
 * 動画面ごとの出力の決まり（描いてよい出力・競合）。判定は World Editor・ubichill dev と同じ `findMediaConflicts`。
 * 読み込んだ mod の宣言（dataFields）で数えるので、まだ読み込んでいない mod の出力は数えない。
 */
export function useMediaSurfaceOwners(): MediaConflicts {
    const { entities } = useWorld();
    const { modMap } = useModRegistry();
    return useMemo(
        () =>
            findMediaConflicts([...entities.values()].map(mediaRecordOf), (type) => {
                const definition = modMap.get(type);
                return definition && 'dataFields' in definition ? definition.dataFields : undefined;
            }),
        [entities, modMap],
    );
}
