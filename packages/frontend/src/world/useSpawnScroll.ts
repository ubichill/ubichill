import { useWorld } from '@ubichill/react';
import { useEffect, useRef } from 'react';
import { scrollWorldTo } from './scrollWorld';
import { spawnCenter } from './worldPlaces';

/** 部屋に入ったとき 1 回だけ、最初の場所（core:spawn）が画面の中心に来るようにする。引っ越しで届き直すスナップショットでは動かさない。 */
export function useSpawnScroll(): void {
    const { entities, environment, hiddenEntities } = useWorld();
    const placed = useRef(false);
    useEffect(() => {
        // 部屋を出る（resetWorld）と空になるので、次の部屋でまた置く
        if (entities.size === 0) {
            placed.current = false;
            return;
        }
        if (placed.current) return;
        placed.current = true;
        const point = spawnCenter(entities.values(), hiddenEntities, Math.random);
        if (point) scrollWorldTo(point, environment.worldSize, 'auto');
    }, [entities, environment.worldSize, hiddenEntities]);
}
