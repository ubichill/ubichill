import { useWorld } from '@ubichill/react';
import { useMemo } from 'react';
import type { EntityScript } from './entityButton';
import { usePortalNavigation } from './portalNavigation';
import { scrollWorldTo } from './scrollWorld';
import { entityCenter } from './worldPlaces';

/**
 * スクリプトを動かす。標準のボタン（スクリプトが自分で描く）と UI のボタンの両方がこれを使い、動き方を 1 か所にする。
 * 動かせない（行き先が無い・移り方が渡されていない）ものは ready が false。
 */
export function useScriptRunner() {
    const { entities, environment, pressSwitch } = useWorld();
    const go = usePortalNavigation();
    return useMemo(() => {
        const warpPoint = (target: string) => (target ? entityCenter(entities.values(), target) : null);
        const ready = (script: EntityScript): boolean => {
            if (script.kind === 'warp') return warpPoint(script.target) !== null;
            if (script.kind === 'switch') return script.ready;
            return !!go && !!script.target;
        };
        const run = (script: EntityScript, portalName: string): void => {
            if (!ready(script)) return;
            if (script.kind === 'warp') {
                const point = warpPoint(script.target);
                if (point) scrollWorldTo(point, environment.worldSize);
            } else if (script.kind === 'switch') {
                pressSwitch(script.id);
            } else if (go && script.target) {
                go(script.target, script.label || portalName);
            }
        };
        return { ready, run };
    }, [entities, environment.worldSize, pressSwitch, go]);
}
