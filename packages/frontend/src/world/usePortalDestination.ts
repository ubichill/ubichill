import { useEffect, useState } from 'react';
import { type PortalDestination, type PortalGoal, usePortalLookup } from './portalNavigation';

/**
 * 行き先のワールドを引く。引けなかったら null、まだ引いていない・引く手段が無い（world.html・エディタの部屋）ときは undefined。
 */
export function usePortalDestination(goal: PortalGoal | null): PortalDestination | null | undefined {
    const lookup = usePortalLookup();
    const key = goal ? JSON.stringify(goal) : '';
    const [found, setFound] = useState<{ key: string; destination: PortalDestination | null } | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 行き先は key（中身）で比べる（goal は描くたびに作り直される）
    useEffect(() => {
        if (!lookup || !goal) return;
        const cancelled = { current: false };
        void lookup(goal).then((destination) => {
            if (!cancelled.current) setFound({ key, destination });
        });
        return () => {
            cancelled.current = true;
        };
    }, [lookup, key]);
    return found?.key === key ? found.destination : undefined;
}
